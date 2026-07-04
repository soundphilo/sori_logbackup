// 💡 URL 파라미터에서 data(blobUrl) 주소를 낚아챕니다.
const urlParams = new URLSearchParams(window.location.search);
const dataBlobUrl = urlParams.get('data');

if (!dataBlobUrl) {
    document.getElementById('output-wrapper').innerHTML = `<h3 class="error-msg">❌ 전달된 데이터가 없습니다. 확장 프로그램을 통해 접근해주세요.</h3>`;
} else {
    // 임시 주소(Blob URL)에 접속해서 JSON 데이터를 가져옵니다.
    fetch(dataBlobUrl)
        .then(response => response.json())
        .then(finalOrderedLogs => {
            renderPreview(finalOrderedLogs);
            // 사용이 끝난 임시 주소는 메모리 해제
            URL.revokeObjectURL(dataBlobUrl); 
        })
        .catch(err => {
            document.getElementById('output-wrapper').innerHTML = `<h3 class="error-msg">❌ 데이터 로드 중 오류가 발생했습니다.</h3>`;
            console.error(err);
        });
}


// 다운로드용 풀 HTML 소스 빌더
function generatePureHtmlHtml(bodyContent) {
    const htmlStyles = `
<style>
body { background-color: #121212; margin: 0; padding: 20px; }
.log-container { width: 100%; max-width: 800px; background-color: #1e1e1e; border-radius: 8px; padding: 20px !important; box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 12px; color: #e0e0e0; font-family: sans-serif; margin: 0 auto; }
.chat-row { display: flex; align-items: flex-start; position: relative; } 
.avatar-box{width:64px;height:64px;margin-right:15px;flex-shrink:0;background-color:#1a1a1a;border-radius:8px;overflow:hidden}
.avatar-box img{width:100%;height:100%;object-fit:contain}
.text-wrap { display: flex; flex-direction: column; flex-grow: 1; padding-right: 60px; } 
.char-name { font-weight: bold; font-size: 14px; margin-bottom: 6px; display: block; }
.bubbles-container { display: flex; flex-direction: column; gap: 4px; }
p.message-bubble { background-color: #141414; border-radius: 8px; padding: 8px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #dddddd; margin: 0; width: fit-content; max-width: 100%; box-sizing: border-box; }
.narration-box { background-color: #2d2d2d; border-radius: 8px; padding: 10px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #ffffff; text-align: center; width: 100%; box-sizing: border-box; margin: 2px 0; }
.tab-tag { position: absolute; top: 2px; right: 2px; display: inline-block; padding: 2px 6px; font-size: 10px; border-radius: 4px; background-color: #333; color: #aaa;}
</style>
    `;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>코코포리아 로그 백업 4.0</title>${htmlStyles}</head><body>${bodyContent}</body></html>`;
}

// 렌더링 및 이벤트 바인딩 함수
function renderPreview(logs) {
    let htmlBody = `<div class="log-container">`;
    let currentGroup = null;

    function closeChatGroup(group) {
        let bubblesHtml = group.messages.map(msg => `<p class="message-bubble">${msg}</p>`).join('');
        const avatarHtml = group.imgUrl ? `<img src="${group.imgUrl}">` : '';
        const renderTag = group.tagHtml ? group.tagHtml : '';
        
        return `
        <div class="chat-row">
            ${renderTag}
            <div class="avatar-box">
                ${avatarHtml}
            </div>
            <div class="text-wrap">
                <span class="char-name" style="color:${group.color}">${group.name}</span>
                <div class="bubbles-container">
                    ${bubblesHtml}
                </div>
            </div>
        </div>`;
    }

    logs.forEach((log) => {
        const tagHtml = (log.tabName === '메인') ? '' : `<span class="tab-tag">${log.tabName}</span>`;

        if (log.isSystem || log.isNarration || log.name === "-") {
            if (currentGroup) {
                htmlBody += closeChatGroup(currentGroup);
                currentGroup = null;
            }
            htmlBody += `<div class="chat-row">${tagHtml}<div class="narration-box">${log.message}</div></div>`;
            return;
        }

        if (currentGroup && currentGroup.imgUrl === log.imgUrl && currentGroup.tabName === log.tabName && currentGroup.name === log.name) {
            currentGroup.messages.push(log.message);
        } else {
            if (currentGroup) {
                htmlBody += closeChatGroup(currentGroup);
            }
            currentGroup = {
                imgUrl: log.imgUrl,
                tabName: log.tabName,
                name: log.name,
                color: log.color,
                tagHtml: tagHtml,
                messages: [log.message]
            };
        }
    });

    if (currentGroup) {
        htmlBody += closeChatGroup(currentGroup);
    }
    htmlBody += `</div>`;

    // 1. 화면 미리보기에 레이아웃 주입
    document.getElementById('output-wrapper').innerHTML = htmlBody;

    // 복사 및 다운로드용 최종 HTML 소스 생성
    const fullHtmlSource = generatePureHtmlHtml(htmlBody);

    // 2. 다운로드 버튼 액션
    document.getElementById('download-btn').addEventListener('click', () => {
        const blob = new Blob([fullHtmlSource], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cocofolia_4.0_log_${Date.now()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // 3. 클립보드 복사 버튼 액션
    document.getElementById('copy-btn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(fullHtmlSource);
            alert("✨ HTML 전체 소스코드가 클립보드에 복사되었습니다!");
        } catch (err) {
            alert("클립보드 복사에 실패했습니다. 보안 설정이나 권한을 확인하세요.");
        }
    });
}
