let globScrapedLogs = null;
let globIncludeChatter = false;
let globLoadedFileText = ""; // 업로드된 파일 텍스트 임시 저장

// 파일 업로드 감지 리스너
document.getElementById('html-file-picker').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 파일 이름에서 확장자(.html, .txt 등)를 떼고 순수 이름만 추출하여 저장
    globOriginFileName = file.name;

    const reader = new FileReader();
    reader.onload = function(evt) {
        globLoadedFileText = evt.target.result;
        processAndRender();
    };
    reader.readAsText(file, "UTF-8");
});

// 1. 확장 프로그램으로부터 순수 데이터 수신
window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'CCFOLIA_RAW_DATA') {
        event.source.postMessage({ type: 'CCFOLIA_DATA_RECEIVED' }, event.origin);
        
        globScrapedLogs = event.data.payload.collectedLogs;
        globIncludeChatter = event.data.payload.includeChatter;
        
        // 유저 선택 드롭다운 채우기
        populateNarrationDropdown();
        
        document.getElementById('output-wrapper').innerHTML = `
            <h3 style="text-align: center; margin-top: 100px; color: #4dadff;">
                ✅ 데이터 수집 완료! 상단에서 [백업 파일 업로드]를 진행해 주세요.
            </h3>
        `;
    }
});

// 대기 상태 기본 안내
document.getElementById('output-wrapper').innerHTML = `
    <h3 style="text-align: center; margin-top: 100px; color: #aaa;">
        ⏳ 확장 프로그램에서 추출 시작 버튼을 눌러주세요...
    </h3>
`;

// 나레이션 드롭다운 생성 함수
function populateNarrationDropdown() {
    const selectEl = document.getElementById('narration-select');
    if (!globScrapedLogs) return;

    const uniqueNames = Array.from(new Set(
        Object.values(globScrapedLogs)
        .map(log => log.name)
        .filter(name => name && !["System", "시스템", "알 수 없음", "-"].includes(name))
    ));

    let dropdownOptions = `<option value="">-- 선택 안함 (지문 없음) --</option>`;
    uniqueNames.forEach(name => {
        dropdownOptions += `<option value="${name}">${name}</option>`;
    });

    selectEl.innerHTML = dropdownOptions;
    selectEl.disabled = false; // 활성화
}


// 나레이션 드롭다운 값이 변경될 때마다 실시간으로 리렌더링 반영!
document.getElementById('narration-select').addEventListener('change', () => {
    if (globLoadedFileText) {
        processAndRender();
    }
});

// 핵심 정렬 및 매칭 로직
function processAndRender() {
    if (!globScrapedLogs || !globLoadedFileText) return;

    const scraperArray = JSON.parse(JSON.stringify(Object.values(globScrapedLogs)));
    const finalOrderedLogs = [];
    const narrationName = document.getElementById('narration-select').value;

    const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    const spanRegex = /<span>\s*\[([^\]]+)\]\s*<\/span>\s*<span>\s*([\s\S]*?)\s*<\/span>\s*:\s*<span>\s*([\s\S]*?)\s*<\/span>/i;

    const getPureKey = (text) => {
        if (!text) return "";
        return text.replace(/&#?[a-z0-9]+;/gi, '').replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
    };

    let match;
    while ((match = pTagRegex.exec(globLoadedFileText)) !== null) {
        const pContent = match[1].trim();
        const logMatch = pContent.match(spanRegex);
        if (!logMatch) continue;

        let fileTabRaw = logMatch[1].trim();
        let fileTab = fileTabRaw.toLowerCase();
        const fileName = logMatch[2].trim().replace(/<[^>]*>/g, '');
        let fileMessage = logMatch[3].trim().replace(/^\s+|\s+$/g, '');
        
        // ✨ [수정 1] 대사가 없는 빈 칸이거나 공백만 있다면 아바타 세트/나레이션 가릴 것 없이 아예 추가하지 않고 패스
        if (!fileMessage) continue;

        const fileMatchKey = getPureKey(fileMessage);

        if (fileTab === 'main') fileTab = '메인';
        else if (fileTab === 'other') fileTab = '잡담';
        else if (fileTab === 'info') fileTab = '정보';

        if (!globIncludeChatter && fileTab === '잡담') continue;

        let matchedLog = scraperArray.find(log => {
            return !log.used && log.tabName === fileTab && log.name === fileName && getPureKey(log.matchKey) === fileMatchKey;
        });
        if (!matchedLog) {
            matchedLog = scraperArray.find(log => {
                return !log.used && log.name === fileName && getPureKey(log.matchKey) === fileMatchKey;
            });
        }
        if (!matchedLog) {
            matchedLog = scraperArray.find(log => {
                return !log.used && getPureKey(log.matchKey) === fileMatchKey;
            });
        }

        const isNarration = (narrationName && fileName === narrationName.trim());
        const isSystem = ["System", "시스템", "system"].includes(fileName);

        if (matchedLog) {
            matchedLog.used = true;
            finalOrderedLogs.push({
                tabName: fileTab,
                name: matchedLog.name,
                imgUrl: matchedLog.imgUrl,
                message: fileMessage,
                color: matchedLog.color,
                isNarration: isNarration,
                isSystem: isSystem
            });
        } else {
            finalOrderedLogs.push({
                tabName: fileTab,
                name: fileName,
                imgUrl: "",
                message: fileMessage,
                color: (fileName === "-" || isSystem) ? "#888888" : "#b4b4b4",
                isNarration: isNarration,
                isSystem: isSystem
            });
        }
    }

    renderPreview(finalOrderedLogs);
}

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
/* ✨ 주사위 전용 밝은 말풍선 스타일 */
p.message-bubble.dice-bubble { background-color: #2a2a2a; color: #ffffff;}
.narration-box { background-color: #2d2d2d; border-radius: 8px; padding: 10px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #ffffff; text-align: center; width: 100%; box-sizing: border-box; margin: 2px 0; }
.tab-tag { position: absolute; top: 2px; right: 2px; display: inline-block; padding: 2px 6px; font-size: 10px; border-radius: 4px; background-color: #333; color: #aaa;}
</style>`;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>코코포리아 로그 백업 4.0</title>${htmlStyles}</head><body>${bodyContent}</body></html>`;
}

function renderPreview(logs) {
    let htmlBody = `<div class="log-container">`;
    let currentGroup = null;

    // 대사 그룹 마감 및 HTML 생성 함수
    function closeChatGroup(group) {
        // 개별 말풍선 생성시 수정/삭제 버튼 및 식별용 데이터(index)를 심어줍니다.
        let bubblesHtml = group.messages.map((msg, subIdx) => {
            const isDice = msg.includes('＞');
            const diceClass = isDice ? ' dice-bubble' : '';
            
            return `
            <div class="bubble-wrapper" data-group-id="${group.id}" data-sub-idx="${subIdx}">
                <p class="message-bubble${diceClass}">${msg}</p>
                <div class="bubble-actions">
                    <button class="action-mini-btn edit-btn">수정</button>
                    <button class="action-mini-btn delete-btn">삭제</button>
                </div>
            </div>`;
        }).join('');

        return `
        <div class="chat-row" id="group-${group.id}">
            ${group.tagHtml || ''}
            <div class="avatar-box">${group.imgUrl ? `<img src="${group.imgUrl}">` : ''}</div>
            <div class="text-wrap">
                <span class="char-name" style="color:${group.color}">${group.name}</span>
                <div class="bubbles-container">${bubblesHtml}</div>
            </div>
        </div>`;
    }

    // 각각의 그룹을 고유하게 식별하기 위한 카운터 변수
    let groupIdCounter = 0;

    logs.forEach((log) => {
        const tagHtml = (log.tabName === '메인') ? '' : `<span class="tab-tag">${log.tabName}</span>`;

        // 나레이션 이거나 시스템 메시지인 경우 처리
        if (log.isSystem || log.isNarration || log.name === "-") {
            if (currentGroup) { htmlBody += closeChatGroup(currentGroup); currentGroup = null; }
            
            // 나레이션 구역도 수정/삭제가 가능하도록 구조화
            groupIdCounter++;
            htmlBody += `
            <div class="chat-row" id="group-${groupIdCounter}">
                ${tagHtml}
                <div class="bubble-wrapper" data-group-id="${groupIdCounter}" data-sub-idx="0" style="width:100%;">
                    <div class="narration-box">${log.message}</div>
                    <div class="bubble-actions" style="position:absolute; right:10px; top:5px;">
                        <button class="action-mini-btn edit-btn">수정</button>
                        <button class="action-mini-btn delete-btn">삭제</button>
                    </div>
                </div>
            </div>`;
            return;
        }

        // 일반 채팅 대사 연속 묶기 판정
        if (currentGroup && currentGroup.imgUrl === log.imgUrl && currentGroup.tabName === log.tabName && currentGroup.name === log.name) {
            currentGroup.messages.push(log.message);
        } else {
            if (currentGroup) htmlBody += closeChatGroup(currentGroup);
            groupIdCounter++;
            currentGroup = { 
                id: groupIdCounter,
                imgUrl: log.imgUrl, 
                tabName: log.tabName, 
                name: log.name, 
                color: log.color, 
                tagHtml: tagHtml, 
                messages: [log.message] 
            };
        }
    });

    if (currentGroup) htmlBody += closeChatGroup(currentGroup);
    htmlBody += `</div>`;

    // 1. 화면에 미리보기 출력
    const wrapper = document.getElementById('output-wrapper');
    wrapper.innerHTML = htmlBody;

    // =======================================================
    // ✨ [실시간 수정/삭제 이벤트 핸들러 빌드]
    // =======================================================
    
    // [삭제 버튼 클릭 처리]
    wrapper.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const wrapperDiv = e.target.closest('.bubble-wrapper');
            const rowDiv = e.target.closest('.chat-row');
            
            // 화면에서 해당 말풍선 엘리먼트 즉시 삭제
            wrapperDiv.remove();
            
            // 만약 캐릭터 대사 묶음 안에 말풍선이 하나도 안 남았다면 줄 자체를 삭제
            const remainingBubbles = rowDiv.querySelectorAll('.bubble-wrapper');
            if (remainingBubbles.length === 0) {
                rowDiv.remove();
            }
            
            // 소스코드 갱신 수집 리렌더링
            updateFinalSource();
        });
    });

    // [수정 버튼 클릭 처리]
    wrapper.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const wrapperDiv = e.target.closest('.bubble-wrapper');
            // 나레이션 박스인지 일반 말풍선인지 판별하여 텍스트 타겟팅
            const targetTextEl = wrapperDiv.querySelector('.message-bubble') || wrapperDiv.querySelector('.narration-box');
            
            const oldText = targetTextEl.innerText;
            const newText = prompt("✏️ 수정할 내용을 입력하세요:", oldText);
            
            if (newText !== null && newText.trim() !== "") {
                targetTextEl.innerText = newText.trim();
                
                // 만약 주사위 판정 기호(＞)가 생기거나 없어졌을 때 실시간 스타일 변형 반영
                if (targetTextEl.classList.contains('message-bubble')) {
                    if (newText.includes('＞')) {
                        targetTextEl.classList.add('dice-bubble');
                    } else {
                        targetTextEl.classList.remove('dice-bubble');
                    }
                }
                
                // 소스코드 갱신 수집 리렌더링
                updateFinalSource();
            }
        });
    });

    // 최종 소스코드를 가공해서 다운로드/복사 버튼에 주입하는 내부 공유 함수
    function updateFinalSource() {
        // 복사나 저장용 파일에는 [수정], [삭제] 툴바 버튼들이 박히면 안되므로, 
        // 화면의 컨테이너를 복제(Clone)해서 버튼 태그들만 다 떼어낸 깨끗한 코드 순수 추출 작업을 진행합니다.
        const cloneContainer = wrapper.querySelector('.log-container').cloneNode(true);
        
        // 다운로드용 코드에서는 버튼 래퍼와 액션 버튼 전원 제거 및 태그 마감 처리
        cloneContainer.querySelectorAll('.bubble-actions').forEach(el => el.remove());
        
        const cleanHtmlContent = cloneContainer.outerHTML;
        const fullHtmlSource = generatePureHtmlHtml(cleanHtmlContent);

        // 버튼 컴포넌트 기능 재매핑
        const copyBtn = document.getElementById('copy-btn');
        const downloadBtn = document.getElementById('download-btn');
        
        copyBtn.disabled = false;
        downloadBtn.disabled = false;

        const newDownload = downloadBtn.cloneNode(true);
        downloadBtn.parentNode.replaceChild(newDownload, downloadBtn);
        newDownload.addEventListener('click', () => {
            const blob = new Blob([fullHtmlSource], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            
            let finalFileName = globOriginFileName.replace(/\s*\[[\s\S]*$/, '').trim() || "cocofolia_processed_log";
            a.download = `${finalFileName}.html`;
            
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        const newCopy = copyBtn.cloneNode(true);
        copyBtn.parentNode.replaceChild(newCopy, copyBtn);
        newCopy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(fullHtmlSource);
                alert("✨ 수정한 내용이 반영된 HTML 전체 소스코드가 클립보드에 복사되었습니다!");
            } catch (err) { alert("클립보드 복사에 실패했습니다."); }
        });
    }

    // 첫 빌드 시점에 초기 소스코드 한 번 전역 주입
    updateFinalSource();
}
