let globScrapedLogs = null;
let globIncludeChatter = false;
let globLoadedFileText = ""; 
let globOriginFileName = "cocofolia_4.0_log"; 

// ✨ [핵심 추가] 현재 화면에 표시되고 있는 최신 로그 상태를 실시간으로 저장하는 배열
let globCurrentProcessedLogs = []; 

// 1. 확장 프로그램으로부터 순수 데이터 수신
window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'CCFOLIA_RAW_DATA') {
        event.source.postMessage({ type: 'CCFOLIA_DATA_RECEIVED' }, event.origin);
        
        globScrapedLogs = event.data.payload.collectedLogs;
        globIncludeChatter = event.data.payload.includeChatter;
        
        populateNarrationDropdown();
        
        document.getElementById('output-wrapper').innerHTML = `
            <h3 style="text-align: center; margin-top: 100px; color: #4dadff;">
                ✅ 데이터 수집 완료! 상단에서 [백업 파일 업로드]를 진행해 주세요.
            </h3>
        `;
    }
});

document.getElementById('output-wrapper').innerHTML = `
    <h3 style="text-align: center; margin-top: 100px; color: #aaa;">
        ⏳ 확장 프로그램에서 추출 시작 버튼을 눌러주세요...
    </h3>
`;

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
    selectEl.disabled = false; 
}

// 파일 업로드 감지 리스너 (최초 1회만 정렬 연산을 수행합니다)
document.getElementById('html-file-picker').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    globOriginFileName = file.name; 

    const reader = new FileReader();
    reader.onload = function(evt) {
        globLoadedFileText = evt.target.result;
        // 파일을 처음 올렸을 때만 최초 매칭 정렬을 실행합니다.
        processFirstTime();
    };
    reader.readAsText(file, "UTF-8");
});

// ✨ [리셋 방지 핵심] 나레이션 드롭다운이 바뀔 때는 처음부터 정렬하지 않고, 
// 현재 보관된 최신 데이터(globCurrentProcessedLogs)의 나레이션 여부(isNarration)만 싹 바꿔서 다시 그립니다!
document.getElementById('narration-select').addEventListener('change', () => {
    if (globCurrentProcessedLogs.length === 0) return;

    const narrationName = document.getElementById('narration-select').value.trim();

    globCurrentProcessedLogs.forEach(log => {
        // 이름이 선택된 나레이션 캐릭터 명과 일치하면 true, 아니면 false 처리 (시스템/대시 기호 제외)
        if (log.name !== "System" && log.name !== "시스템" && log.name !== "-") {
            log.isNarration = (narrationName && log.name === narrationName);
        }
    });

    // 데이터는 그대로 유지한 채 화면만 리렌더링!
    renderPreview(globCurrentProcessedLogs);
});

// 최초 1회 파일 업로드 시점에만 동작하는 파싱 및 정렬 로직
function processFirstTime() {
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

    // ✨ 전역 변수에 가공 완료된 최초 데이터를 백업해 둡니다.
    globCurrentProcessedLogs = finalOrderedLogs;

    // 화면 렌더링 시작
    renderPreview(globCurrentProcessedLogs);
}

function generatePureHtmlHtml(bodyContent) {
    const htmlStyles = `
<style>
.log-container { 
    width: 100%; 
    max-width: 800px; 
    background-color: #1e1e1e !important; 
    border-radius: 8px; 
    padding: 20px !important; 
    box-shadow: 0 4px 10px rgba(0,0,0,0.3); 
    display: flex; 
    flex-direction: column; 
    gap: 12px; 
    color: #e0e0e0 !important; 
    font-family: sans-serif; 
    margin: 20px auto !important; 
    box-sizing: border-box !important;
}
.chat-row { display: flex; align-items: flex-start; position: relative; margin: 0 !important; padding: 0 !important; } 
.avatar-box { width: 64px !important; height: 64px !important; margin-right: 15px !important; flex-shrink: 0; background-color: #1a1a1a; border-radius: 8px; overflow: hidden; }
.avatar-box img { width: 100% !important; height: 100% !important; object-fit: contain !important; margin: 0 !important; padding: 0 !important; }
.text-wrap { display: flex; flex-direction: column; flex-grow: 1; padding-right: 60px; } 
.char-name { font-weight: bold; font-size: 14px; margin-bottom: 6px; display: block; }
.bubbles-container { display: flex; flex-direction: column; gap: 4px; }
p.message-bubble { background-color: #141414 !important; border-radius: 8px; padding: 8px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #dddddd !important; margin: 0 !important; width: fit-content; max-width: 100%; box-sizing: border-box; }
p.message-bubble.dice-bubble { background-color: #2a2a2a !important; color: #ffffff !important; border: 1px solid #444 !important; }
.narration-box { background-color: #2d2d2d !important; border-radius: 8px; padding: 10px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #ffffff !important; text-align: center; width: 100%; box-sizing: border-box; margin: 2px 0 !important; }
.tab-tag { position: absolute; top: 2px; right: 2px; display: inline-block; padding: 2px 6px; font-size: 10px; border-radius: 4px; background-color: #333 !important; color: #aaa !important; }
</style>`;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>코코포리아 로그 백업 4.0</title>${htmlStyles}</head><body>${bodyContent}</body></html>`;
}

function renderPreview(logs) {
    let htmlBody = `<div class="log-container">`;
    let currentGroup = null;

    function closeChatGroup(group) {
        let bubblesHtml = group.messages.map((mObj) => {
            const isDice = mObj.text.includes('＞');
            const diceClass = isDice ? ' dice-bubble' : '';
            
            return `
            <div class="bubble-wrapper" data-log-uid="${mObj.uid}">
                <p class="message-bubble${diceClass}">${mObj.text}</p>
                <div class="bubble-actions">
                    <button class="action-mini-btn edit-btn">✏️ 수정</button>
                    <button class="action-mini-btn delete-btn">❌ 삭제</button>
                </div>
            </div>`;
        }).join('');

        return `
        <div class="chat-row">
            ${group.tagHtml || ''}
            <div class="avatar-box">${group.imgUrl ? `<img src="${group.imgUrl}">` : ''}</div>
            <div class="text-wrap">
                <span class="char-name" style="color:${group.color}">${group.name}</span>
                <div class="bubbles-container">${bubblesHtml}</div>
            </div>
        </div>`;
    }

    // 데이터 핸들링을 위해 개별 로그마다 고유 임시 UID를 부여하여 렌더링
    let logUidCounter = 0;
    
    // 조립 전 원본 주소 연결용 고유 아이디 맵핑 작업 수행
    logs.forEach(log => { if(!log.uid) { logUidCounter++; log.uid = logUidCounter; } });

    logs.forEach((log) => {
        const tagHtml = (log.tabName === '메인') ? '' : `<span class="tab-tag">${log.tabName}</span>`;

        if (log.isSystem || log.isNarration || log.name === "-") {
            if (currentGroup) { htmlBody += closeChatGroup(currentGroup); currentGroup = null; }
            
            htmlBody += `
            <div class="chat-row">
                ${tagHtml}
                <div class="bubble-wrapper" data-log-uid="${log.uid}" style="width:100%;">
                    <div class="narration-box">${log.message}</div>
                    <div class="bubble-actions" style="position:absolute; right:10px; top:5px;">
                        <button class="action-mini-btn edit-btn">✏️ 수정</button>
                        <button class="action-mini-btn delete-btn">❌ 삭제</button>
                    </div>
                </div>
            </div>`;
            return;
        }

        if (currentGroup && currentGroup.imgUrl === log.imgUrl && currentGroup.tabName === log.tabName && currentGroup.name === log.name) {
            currentGroup.messages.push({ uid: log.uid, text: log.message });
        } else {
            if (currentGroup) htmlBody += closeChatGroup(currentGroup);
            currentGroup = { 
                imgUrl: log.imgUrl, 
                tabName: log.tabName, 
                name: log.name, 
                color: log.color, 
                tagHtml: tagHtml, 
                messages: [{ uid: log.uid, text: log.message }] 
            };
        }
    });

    if (currentGroup) htmlBody += closeChatGroup(currentGroup);
    htmlBody += `</div>`;

    const wrapper = document.getElementById('output-wrapper');
    wrapper.innerHTML = htmlBody;

    // 2-1. [실시간 삭제 기능 구현] -> 메모리 데이터 배열에서도 실시간 동기화 삭제
    wrapper.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const wrapperDiv = e.target.closest('.bubble-wrapper');
            const targetUid = parseInt(wrapperDiv.getAttribute('data-log-uid'), 10);
            
            // 전역 메모리 배열(globCurrentProcessedLogs)에서 해당 고유 아이디 대사를 영구 영구 격리
            globCurrentProcessedLogs = globCurrentProcessedLogs.filter(log => log.uid !== targetUid);
            
            // 화면 레이아웃 새로고침 (정렬 묶음 깨짐 방지를 위해 재렌더링 처리)
            renderPreview(globCurrentProcessedLogs);
        });
    });

    // 2-2. [실시간 수정 기능 구현] -> 메모리 데이터 배열에서도 실시간 내용 동기화 업데이트
    wrapper.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const wrapperDiv = e.target.closest('.bubble-wrapper');
            const targetUid = parseInt(wrapperDiv.getAttribute('data-log-uid'), 10);
            const targetTextEl = wrapperDiv.querySelector('.message-bubble') || wrapperDiv.querySelector('.narration-box');
            
            const oldText = targetTextEl.innerText;
            const newText = prompt("✏️ 수정할 내용을 입력하세요:", oldText);
            
            if (newText !== null && newText.trim() !== "") {
                // 전역 메모리 저장소 내부 데이터 원본을 수정
                const targetLogData = globCurrentProcessedLogs.find(log => log.uid === targetUid);
                if (targetLogData) {
                    targetLogData.message = newText.trim();
                }
                
                // 화면 리렌더링
                renderPreview(globCurrentProcessedLogs);
            }
        });
    });

    // 최종 산출물 코드 구성 및 업로드 버튼 연동 바인딩 처리
    function updateFinalSource() {
        const cloneContainer = wrapper.querySelector('.log-container').cloneNode(true);
        cloneContainer.querySelectorAll('.bubble-actions').forEach(el => el.remove());
        
        const cleanHtmlContent = cloneContainer.outerHTML;
        const fullHtmlSource = generatePureHtmlHtml(cleanHtmlContent);

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

    updateFinalSource();
}
