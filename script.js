let globScrapedLogs = null;
let globIncludeChatter = false;
let globLoadedFileText = ""; 
let globOriginFileName = ""; 
// ✨ 파싱된 로그 데이터를 전역에서 관리하여 수정/삭제 내역을 철저히 보존합니다.
let globParsedLogs = null; 

// 1. 확장 프로그램으로부터 데이터 수신
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

// 2. 파일 업로드 감지 리스너
document.getElementById('html-file-picker').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    globOriginFileName = file.name;

    const reader = new FileReader();
    reader.onload = function(evt) {
        globLoadedFileText = evt.target.result;
        
        // 파일을 처음 올렸을 때만 '최초 1회' 파싱을 수행하여 데이터를 전역 배열에 담습니다.
        initialParseRawText(); 
        
        // 파싱이 끝났으니 화면을 그립니다.
        refreshContent();
    };
    reader.readAsText(file, "UTF-8");
});

// 3. 테마 변경 감지 리스너
document.getElementById('theme-select').addEventListener('change', (e) => {
    const selectedTheme = e.target.value;
    if (selectedTheme === 'light') {
        document.body.classList.add('light-theme-view');
    } else {
        document.body.classList.remove('light-theme-view');
    }
    
    // 다시 처음부터 파싱하지 않고, 사용자가 수정한 내역이 남아있는 데이터로 화면만 새로 고칩니다.
    if (globParsedLogs) {
        refreshContent();
    }
});

// 4. 나레이션 변경 감지 리스너
document.getElementById('narration-select').addEventListener('change', () => {
    if (globParsedLogs) {
        // 나레이션 캐릭터가 바뀌었으므로 기존 데이터의 속성(isNarration)만 업데이트합니다.
        const narrationName = document.getElementById('narration-select').value.trim();
        
        globParsedLogs.forEach(log => {
            if (!log.isSystem && log.name !== "-") {
                log.isNarration = (narrationName && log.name === narrationName);
            }
        });
        
        // 데이터 업데이트 후 화면 갱신
        refreshContent();
    }
});

// 초기 대기 메시지
document.getElementById('output-wrapper').innerHTML = `
    <h3 style="text-align: center; margin-top: 100px; color: #aaa;">
        ⏳ 확장 프로그램에서 추출 시작 버튼을 눌러주세요...
    </h3>
`;

// 나레이션 드롭다운 생성
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

// 최초 1회만 실행되어 원본 HTML을 배열 데이터 구조로 파싱하는 함수
function initialParseRawText() {
    if (!globScrapedLogs || !globLoadedFileText) return;

    const scraperArray = JSON.parse(JSON.stringify(Object.values(globScrapedLogs)));
    globParsedLogs = []; 
    
    const narrationName = document.getElementById('narration-select').value.trim();

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

        const isNarration = (narrationName && fileName === narrationName);
        const isSystem = ["System", "시스템", "system"].includes(fileName);

        if (matchedLog) {
            matchedLog.used = true;
            globParsedLogs.push({
                id: Math.random().toString(36).substr(2, 9), // 고유 식별자 ID 부여
                tabName: fileTab,
                name: matchedLog.name,
                imgUrl: matchedLog.imgUrl,
                message: fileMessage,
                color: matchedLog.color,
                isNarration: isNarration,
                isSystem: isSystem
            });
        } else {
            globParsedLogs.push({
                id: Math.random().toString(36).substr(2, 9),
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
}

// 현재 들고 있는 데이터(수정본 포함)를 기반으로 화면을 갱신하는 함수
function refreshContent() {
    if (!globParsedLogs) return;
    renderPreview(globParsedLogs);
}

// ✨ 외부 스킨에 영향을 주지 않는 컴포넌트형 HTML 소스 생성 함수 (body 제거 완료)
function generatePureHtmlHtml(bodyContent) {
    const currentTheme = document.getElementById('theme-select').value;
    const colors = THEME_STYLES[currentTheme] || THEME_STYLES.dark;
    
    const htmlStyles = `
<style>
.log-container { 
    width: 100%; 
    max-width: 800px; 
    background-color: ${colors.containerBg} !important; 
    border-radius: 8px; 
    padding: 20px !important; 
    box-shadow: 0 4px 10px rgba(0,0,0,0.15); 
    display: flex; 
    flex-direction: column; 
    gap: 12px; 
    color: ${colors.textMain} !important; 
    font-family: sans-serif; 
    margin: 20px auto; 
    box-sizing: border-box;
}
.chat-row { display: flex; align-items: flex-start; position: relative; width: 100%; box-sizing: border-box; } 
.avatar-box { 
    width: 64px; 
    height: 64px; 
    margin-right: 15px; 
    flex-shrink: 0; 
    background-color: ${colors.bubbleBg} !important; /* ✨ 아바타 배경색도 테마와 자연스럽게 연동 */
    border-radius: 8px; 
    overflow: hidden; 
}
.avatar-box img { width: 100%; height: 100%; object-fit: contain; display: block; }
.text-wrap { display: flex; flex-direction: column; flex-grow: 1; padding-right: 60px; min-width: 0; } 
.char-name { font-weight: bold; font-size: 14px; margin-bottom: 6px; display: block; }
.bubbles-container { display: flex; flex-direction: column; gap: 4px; width: 100%; }
p.message-bubble { 
    background-color: ${colors.bubbleBg} !important; 
    border-radius: 8px; 
    padding: 8px 14px !important; 
    font-size: 14px; 
    line-height: 1.6; 
    white-space: pre-wrap; 
    word-break: break-all; 
    color: ${colors.textBubble} !important; 
    margin: 0; 
    width: fit-content; 
    max-width: 100%; 
    box-sizing: border-box; 
}
p.message-bubble.dice-bubble { 
    background-color: ${colors.diceBg} !important; 
    color: ${colors.textDice} !important;
}
.narration-box { 
    background-color: ${colors.narrationBg} !important; 
    border-radius: 8px; 
    padding: 10px 14px !important; 
    font-size: 14px; 
    line-height: 1.6; 
    white-space: pre-wrap; 
    word-break: break-all; 
    color: ${colors.textNarration} !important; 
    text-align: center; 
    width: 100%; 
    box-sizing: border-box; 
    margin: 2px 0; 
}
.tab-tag { 
    position: absolute; 
    top: 2px; 
    right: 2px; 
    display: inline-block; 
    padding: 2px 6px; 
    font-size: 10px; 
    border-radius: 4px; 
    background-color: #333 !important; 
    color: #aaa !important;
}
</style>`;

    // html, head, body 태그 없이 딱 스타일과 핵심 태그 덩어리만 반환합니다.
    return `${htmlStyles}${bodyContent}`;
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
                imgUrl: log.imgUrl, 
                tabName: log.tabName, 
                name: log.name, 
                color: log.color, 
                tagHtml: tagHtml, 
                messages: [{ id: log.id, message: log.message }] 
            };
        }
    });

    if (currentGroup) htmlBody += closeChatGroup(currentGroup);
    htmlBody += `</div>`;

    const wrapper = document.getElementById('output-wrapper');
    wrapper.innerHTML = htmlBody;

    // 🗑️ 삭제 버튼 리스너 (데이터 전역 배열 실시간 동기화)
    wrapper.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const wrapperDiv = e.target.closest('.bubble-wrapper');
            const logId = wrapperDiv.getAttribute('data-log-id');
            
            globParsedLogs = globParsedLogs.filter(log => log.id !== logId);
            refreshContent();
        });
    });

    // ✏️ 수정 버튼 리스너 (데이터 전역 배열 실시간 동기화)
    wrapper.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const wrapperDiv = e.target.closest('.bubble-wrapper');
            const logId = wrapperDiv.getAttribute('data-log-id');
            const targetTextEl = wrapperDiv.querySelector('.message-bubble') || wrapperDiv.querySelector('.narration-box');
            
            const oldText = targetTextEl.innerText;
            const newText = prompt("✏️ 수정할 내용을 입력하세요:", oldText);
            
            if (newText !== null && newText.trim() !== "") {
                const cleanedText = newText.trim();
                
                const targetLog = globParsedLogs.find(log => log.id === logId);
                if (targetLog) {
                    targetLog.message = cleanedText;
                }
                refreshContent();
            }
        });
    });

    updateFinalSource();
}

function updateFinalSource() {
    const wrapper = document.getElementById('output-wrapper');
    const logContainer = wrapper.querySelector('.log-container');
    if (!logContainer) return;

    const cloneContainer = logContainer.cloneNode(true);
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
            alert("✨ 선택하신 테마가 반영된 HTML 전체 소스코드가 클립보드에 복사되었습니다!");
        } catch (err) { alert("클립보드 복사에 실패했습니다."); }
    });
}
