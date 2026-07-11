// ==========================================
// [1] 전역 상태 관리 (State)
// ==========================================
let globScrapedLogs = null;
let globIncludeChatter = false;
let globLoadedFileText = ""; 
let globOriginFileName = ""; 
let globParsedLogs = null; 

// ==========================================
// [2] 유틸리티 및 데이터 가공 함수
// ==========================================

const getPureKey = (text) => {
    if (!text) return "";
    return text.replace(/&#?[a-z0-9]+;/gi, '').replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
};

function generatePureHtmlHtml(bodyContent) {
    const currentTheme = document.getElementById('theme-select').value;
    const colors = THEME_STYLES[currentTheme] || THEME_STYLES.dark;
    
    const htmlStyles = `
<style>
.log-container { width: 100%; max-width: 800px; background-color: ${colors.containerBg} !important; border-radius: 8px; padding: 20px !important; box-shadow: 0 4px 10px rgba(0,0,0,0.15); display: flex; flex-direction: column; gap: 12px; color: ${colors.textMain} !important; font-family: sans-serif; margin: 20px auto; box-sizing: border-box; }
.chat-row { display: flex; align-items: flex-start; position: relative; width: 100%; box-sizing: border-box; } 
.avatar-box { width: 64px; height: 64px; margin-right: 15px; flex-shrink: 0; background-color: ${colors.bubbleBg} !important; border-radius: 8px; overflow: hidden; }
.avatar-box img { width: 100%; height: 100%; object-fit: contain; display: block; }
.text-wrap { display: flex; flex-direction: column; flex-grow: 1; padding-right: 60px; min-width: 0; } 
.char-name { font-weight: bold; font-size: 14px; margin-bottom: 6px; display: block; }
.bubbles-container { display: flex; flex-direction: column; gap: 4px; width: 100%; }
p.message-bubble { background-color: ${colors.bubbleBg} !important; border-radius: 8px; padding: 8px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: ${colors.textBubble} !important; margin: 0; width: fit-content; max-width: 100%; box-sizing: border-box; }
p.message-bubble.dice-bubble { background-color: ${colors.diceBg} !important; color: ${colors.textDice} !important; }
.narration-box { background-color: ${colors.narrationBg} !important; border-radius: 8px; padding: 10px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: ${colors.textNarration} !important; text-align: center; width: 100%; box-sizing: border-box; margin: 2px 0; }
.tab-tag { position: absolute; top: 2px; right: 2px; display: inline-block; padding: 2px 6px; font-size: 10px; border-radius: 4px; background-color: #333 !important; color: #aaa !important; }
</style>`;

    return `${htmlStyles}${bodyContent}`;
}

// ==========================================
// [3] 비즈니스 로직 및 파싱 엔진
// ==========================================

function populateNarrationDropdown() {
    const selectEl = document.getElementById('narration-select');
    if (!globScrapedLogs) return;

    const uniqueNames = Array.from(new Set(
        Object.values(globScrapedLogs).map(log => log.name)
        .filter(name => name && !["System", "시스템", "알 수 없음", "-"].includes(name))
    ));

    let dropdownOptions = `<option value="">-- 선택 안함 (지문 없음) --</option>`;
    uniqueNames.forEach(name => { dropdownOptions += `<option value="${name}">${name}</option>`; });
    selectEl.innerHTML = dropdownOptions;
    
    // 💡 [수정] 나레이션 드롭다운 활성화 조건 변경: 확장 프로그램 연동 시점이 아닌 '실제 파일 업로드 완료 시점'으로 이동하기 위해 여기서는 해제하지 않음
}

function initialParseRawText() {
    if (!globScrapedLogs || !globLoadedFileText) return;

    const scraperArray = JSON.parse(JSON.stringify(Object.values(globScrapedLogs)));
    globParsedLogs = []; 
    
    const narrationName = document.getElementById('narration-select').value.trim();
    const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    const spanRegex = /<span>\s*\[([^\]]+)\]\s*<\/span>\s*<span>\s*([\s\S]*?)\s*<\/span>\s*:\s*<span>\s*([\s\S]*?)\s*<\/span>/i;

    let match;
    while ((match = pTagRegex.exec(globLoadedFileText)) !== null) {
        const pContent = match[1].trim();
        const logMatch = pContent.match(spanRegex);
        if (!logMatch) continue;

        let fileTab = logMatch[1].trim().toLowerCase();
        const fileName = logMatch[2].trim().replace(/<[^>]*>/g, '');
        let fileMessage = logMatch[3].trim().replace(/^\s+|\s+$/g, '');
        
        if (!fileMessage) continue;
        const fileMatchKey = getPureKey(fileMessage);

        if (fileTab === 'main') fileTab = '메인';
        else if (fileTab === 'other') fileTab = '잡담';
        else if (fileTab === 'info') fileTab = '정보';

        if (!globIncludeChatter && fileTab === '잡담') continue;

        let matchedLog = scraperArray.find(log => !log.used && log.tabName === fileTab && log.name === fileName && getPureKey(log.matchKey) === fileMatchKey);
        if (!matchedLog) matchedLog = scraperArray.find(log => !log.used && log.name === fileName && getPureKey(log.matchKey) === fileMatchKey);
        if (!matchedLog) matchedLog = scraperArray.find(log => !log.used && getPureKey(log.matchKey) === fileMatchKey);

        const isNarration = (narrationName && fileName === narrationName);
        const isSystem = ["System", "시스템", "system"].includes(fileName);

        const logPayload = {
            id: Math.random().toString(36).substr(2, 9),
            tabName: fileTab,
            name: matchedLog ? matchedLog.name : fileName,
            imgUrl: matchedLog ? matchedLog.imgUrl : "",
            message: fileMessage,
            color: matchedLog ? matchedLog.color : ((fileName === "-" || isSystem) ? "#888888" : "#b4b4b4"),
            isNarration: isNarration,
            isSystem: isSystem
        };

        if (matchedLog) matchedLog.used = true;
        globParsedLogs.push(logPayload);
    }
}

function refreshContent() {
    if (!globParsedLogs) return;
    renderPreview(globParsedLogs);
}

function renderPreview(logs) {
    let htmlBody = `<div class="log-container">`;
    let currentGroup = null;

    function closeChatGroup(group) {
        let bubblesHtml = group.messages.map((msgObj) => {
            const isDice = msgObj.message.includes('＞');
            const diceClass = isDice ? ' dice-bubble' : '';
            return `
            <div class="bubble-wrapper" data-log-id="${msgObj.id}">
                <p class="message-bubble${diceClass}">${msgObj.message}</p>
                <div class="bubble-actions">
                    <button class="action-mini-btn edit-btn">수정</button>
                    <button class="action-mini-btn delete-btn">삭제</button>
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

    logs.forEach((log) => {
        const tagHtml = (log.tabName === '메인') ? '' : `<span class="tab-tag">${log.tabName}</span>`;

        if (log.isSystem || log.isNarration || log.name === "-") {
            if (currentGroup) { htmlBody += closeChatGroup(currentGroup); currentGroup = null; }
            htmlBody += `
            <div class="chat-row">
                ${tagHtml}
                <div class="bubble-wrapper" data-log-id="${log.id}" style="width:100%;">
                    <div class="narration-box">${log.message}</div>
                    <div class="bubble-actions" style="position:absolute; right:10px; top:5px;">
                        <button class="action-mini-btn edit-btn">수정</button>
                        <button class="action-mini-btn delete-btn">삭제</button>
                    </div>
                </div>
            </div>`;
            return;
        }

        if (currentGroup && currentGroup.imgUrl === log.imgUrl && currentGroup.tabName === log.tabName && currentGroup.name === log.name) {
            currentGroup.messages.push({ id: log.id, message: log.message });
        } else {
            if (currentGroup) htmlBody += closeChatGroup(currentGroup);
            currentGroup = { 
                imgUrl: log.imgUrl, tabName: log.tabName, name: log.name, color: log.color, tagHtml: tagHtml, 
                messages: [{ id: log.id, message: log.message }] 
            };
        }
    });

    if (currentGroup) htmlBody += closeChatGroup(currentGroup);
    htmlBody += `</div>`;

    const wrapper = document.getElementById('output-wrapper');
    wrapper.innerHTML = htmlBody;

    bindPreviewActions(wrapper);

    document.getElementById('copy-btn').disabled = false;
    document.getElementById('download-btn').disabled = false;
}

function bindPreviewActions(wrapper) {
    wrapper.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const logId = e.target.closest('.bubble-wrapper').getAttribute('data-log-id');
            globParsedLogs = globParsedLogs.filter(log => log.id !== logId);
            refreshContent();
        });
    });

    wrapper.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const logId = e.target.closest('.bubble-wrapper').getAttribute('data-log-id');
            const targetTextEl = e.target.closest('.bubble-wrapper').querySelector('.message-bubble, .narration-box');
            
            const newText = prompt("✏️ 수정할 내용을 입력하세요:", targetTextEl.innerText);
            if (newText !== null && newText.trim() !== "") {
                const targetLog = globParsedLogs.find(log => log.id === logId);
                if (targetLog) targetLog.message = newText.trim();
                refreshContent();
            }
        });
    });
}

function buildFinalHtmlSource() {
    const logContainer = document.querySelector('#output-wrapper .log-container');
    if (!logContainer) return "";

    const cloneContainer = logContainer.cloneNode(true);
    cloneContainer.querySelectorAll('.bubble-actions').forEach(el => el.remove());
    
    return generatePureHtmlHtml(cloneContainer.outerHTML);
}

// ==========================================
// [4] 이벤트 리스너 및 초기화 (Global Events)
// ==========================================

// 초기 상태: 제어 컨트롤들 명시적 잠금 활성화
document.getElementById('theme-select').disabled = true;
document.getElementById('narration-select').disabled = true;

document.getElementById('output-wrapper').innerHTML = `
    <h3 style="text-align: center; margin-top: 100px; color: #aaa;">
        ⏳ 확장 프로그램에서 추출 시작 버튼을 눌러주세요...
    </h3>
`;

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

document.getElementById('html-file-picker').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    globOriginFileName = file.name;

    const reader = new FileReader();
    reader.onload = function(evt) {
        globLoadedFileText = evt.target.result;
        initialParseRawText(); 
        
        // 🌟 [핵심 변경 사항]: 파일이 정상적으로 업로드되면 테마 및 나레이션 선택창 활성화
        document.getElementById('theme-select').disabled = false;
        document.getElementById('narration-select').disabled = false;
        
        refreshContent();
    };
    reader.readAsText(file, "UTF-8");
});

document.getElementById('theme-select').addEventListener('change', (e) => {
    if (e.target.value === 'light') document.body.classList.add('light-theme-view');
    else document.body.classList.remove('light-theme-view');
    if (globParsedLogs) refreshContent();
});

document.getElementById('narration-select').addEventListener('change', () => {
    if (globParsedLogs) {
        const narrationName = document.getElementById('narration-select').value.trim();
        globParsedLogs.forEach(log => {
            if (!log.isSystem && log.name !== "-") {
                log.isNarration = (narrationName && log.name === narrationName);
            }
        });
        refreshContent();
    }
});

document.getElementById('download-btn').addEventListener('click', () => {
    const fullHtmlSource = buildFinalHtmlSource();
    if (!fullHtmlSource) return;

    const blob = new Blob([fullHtmlSource], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    
    let baseName = "cocofolia_processed_log";
    if (globOriginFileName) {
        let nameWithoutExt = globOriginFileName.replace(/\.[^/.]+$/, "");
        baseName = nameWithoutExt.replace(/\[[^\]]+\]$/, '').trim();
    }
    
    a.download = `${baseName || "cocofolia_processed_log"}.html`;
    
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

document.getElementById('copy-btn').addEventListener('click', async () => {
    const fullHtmlSource = buildFinalHtmlSource();
    if (!fullHtmlSource) return;

    try {
        await navigator.clipboard.writeText(fullHtmlSource);
        alert("✨ 선택하신 테마가 반영된 HTML 전체 소스코드가 클립보드에 복사되었습니다!");
    } catch (err) { 
        alert("클립보드 복사에 실패했습니다."); 
    }
});
