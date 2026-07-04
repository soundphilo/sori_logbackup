let generatedHtmlBody = ""; 
let scraperLogs = []; // 확장 프로그램 창고에서 꺼내온 데이터가 담길 곳

// 🎯 [수정된 핵심 파트] 이제 주소창(?data=...) 대신 확장 프로그램의 로컬 창고에서 안전하게 데이터를 꺼내옵니다.
document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');

    // 확장 프로그램 환경의 창고(chrome.storage)가 활성화되어 있는지 확인
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["ccfolia_scraped_data"], (result) => {
            const receivedData = result.ccfolia_scraped_data;
            
            if (receivedData) {
                try {
                    const parsed = JSON.parse(receivedData);
                    scraperLogs = Object.values(parsed);
                    statusDiv.innerText = "✅ 확장 프로그램 데이터 연동 완료! 파일을 업로드해 주세요.";
                    statusDiv.style.color = "#4caf50";
                    
                    // 다음 연동을 위해 사용한 임시 데이터는 창고에서 깔끔하게 비워줍니다.
                    chrome.storage.local.remove(["ccfolia_scraped_data"]);
                } catch (e) {
                    statusDiv.innerText = "❌ 데이터 복원 오류가 발생했습니다.";
                    statusDiv.style.color = "#f44336";
                    console.error(e);
                }
            } else {
                statusDiv.innerText = "⚠️ 확장 프로그램으로부터 전달받은 최신 데이터가 없습니다. 확장 프로그램을 먼저 실행해 주세요.";
                statusDiv.style.color = "#ff9800";
            }
        });
    } else {
        // 일반 브라우저로 주소 직접 입력해서 들어왔을 때의 안내
        statusDiv.innerText = "ℹ️ 확장 프로그램을 통해 코코포리아 룸에서 데이터를 전송한 뒤 이용해 주세요.";
        statusDiv.style.color = "#2196f3";
    }
});

// 👇 여기서부터 아래 코드들은 기존 유저님이 올려주신 코드와 100% 동일합니다!
document.getElementById('preview-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('log-file');
    const narrationName = document.getElementById('narration-name').value.trim();
    const includeChatter = document.getElementById('include-chatter').checked;

    if (scraperLogs.length === 0) {
        alert("❌ 확장 프로그램을 통해 데이터를 먼저 전송받아야 합니다!");
        return;
    }
    if (!fileInput.files || fileInput.files.length === 0) {
        alert("❌ 코코포리아 백업 HTML 파일을 업로드해 주세요!");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = function(e) {
        generatePreview(e.target.result, narrationName, includeChatter);
    };
    reader.readAsText(file);
});

function generatePreview(fileText, narrationName, includeChatter) {
    const finalOrderedLogs = [];
    const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    const spanRegex = /<span>\s*\[([^\]]+)\]\s*<\/span>\s*<span>\s*([\s\S]*?)\s*<\/span>\s*:\s*<span>\s*([\s\S]*?)\s*<\/span>/i;

    const getPureKey = (text) => {
        if (!text) return "";
        return text
            .replace(/&#?[a-z0-9]+;/gi, '')
            .replace(/<[^>]*>/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, '');
    };

    let match;
    while ((match = pTagRegex.exec(fileText)) !== null) {
        const pContent = match[1].trim();
        const logMatch = pContent.match(spanRegex);
        
        if (!logMatch) continue;

        let fileTabRaw = logMatch[1].trim(); 
        let fileTab = fileTabRaw.toLowerCase(); 
        const fileName = logMatch[2].trim().replace(/<[^>]*>/g, ''); 
        let fileMessage = logMatch[3].trim();
        
        fileMessage = fileMessage.replace(/^\s+|\s+$/g, '');
        const fileMatchKey = getPureKey(fileMessage); 

        if (fileTab === 'main') fileTab = '메인';
        else if (fileTab === 'other') fileTab = '잡담';
        else if (fileTab === 'info') fileTab = '정보';

        if (!includeChatter && fileTab === '잡담') continue; 

        // 3.6 유니코드 무적 매칭 레이어
        let matchedLog = scraperLogs.find(log => {
            const cleanScrapKey = getPureKey(log.matchKey);
            return !log.used && log.tabName === fileTab && log.name === fileName && cleanScrapKey === fileMatchKey;
        });

        if (!matchedLog) {
            matchedLog = scraperLogs.find(log => {
                const cleanScrapKey = getPureKey(log.matchKey);
                return !log.used && log.name === fileName && cleanScrapKey === fileMatchKey;
            });
        }

        if (!matchedLog) {
            matchedLog = scraperLogs.find(log => {
                const cleanScrapKey = getPureKey(log.matchKey);
                return !log.used && cleanScrapKey === fileMatchKey;
            });
        }

        const isNarration = (narrationName && fileName === narrationName.trim());
        const isSystem = (fileName === "System" || fileName === "시스템" || fileName === "system");

        if (matchedLog) {
            matchedLog.used = true; 
            finalOrderedLogs.push({
                tabName: fileTab, name: matchedLog.name, imgUrl: matchedLog.imgUrl, message: fileMessage, color: matchedLog.color, isNarration: isNarration, isSystem: isSystem
            });
        } else {
            finalOrderedLogs.push({
                tabName: fileTab, name: fileName, imgUrl: "", message: fileMessage, color: (fileName === "-" || isSystem) ? "#888888" : "#b4b4b4", isNarration: isNarration, isSystem: isSystem
            });
        }
    }

    let htmlBody = `<div class="log-container">`;
    let currentGroup = null; 

    finalOrderedLogs.forEach((log) => {
        const tagHtml = (log.tabName === '메인') ? '' : `<span class="tab-tag">${log.tabName}</span>`;

        if (log.isSystem || log.isNarration || log.name === "-") {
            if (currentGroup) { htmlBody += closeChatGroup(currentGroup); currentGroup = null; }
            htmlBody += `<div class="chat-row">${tagHtml}<div class="narration-box">${log.message}</div></div>`;
            return;
        }

        if (currentGroup && currentGroup.imgUrl === log.imgUrl && currentGroup.tabName === log.tabName && currentGroup.name === log.name) {
            currentGroup.messages.push(log.message);
        } else {
            if (currentGroup) htmlBody += closeChatGroup(currentGroup);
            currentGroup = { imgUrl: log.imgUrl, tabName: log.tabName, name: log.name, color: log.color, tagHtml: tagHtml, messages: [log.message] };
        }
    });

    if (currentGroup) htmlBody += closeChatGroup(currentGroup);
    htmlBody += `</div>`;

    generatedHtmlBody = htmlBody;

    document.getElementById('preview-container').innerHTML = htmlBody;
    document.getElementById('preview-area').style.display = 'block';
    document.getElementById('preview-area').scrollIntoView({ behavior: 'smooth' });

    function closeChatGroup(group) {
        let bubblesHtml = group.messages.map(msg => `<p class="message-bubble">${msg}</p>`).join('');
        const avatarHtml = group.imgUrl ? `<img src="${group.imgUrl}">` : '';
        return `<div class="chat-row">${group.tagHtml}<div class="avatar-box">${avatarHtml}</div><div class="text-wrap"><span class="char-name" style="color:${group.color}">${group.name}</span><div class="bubbles-container">${bubblesHtml}</div></div></div>`;
    }
}

document.getElementById('download-btn').addEventListener('click', () => {
    if (!generatedHtmlBody) return;

    const htmlStyles = `
    <style>
    .log-container { width: 100%; max-width: 800px; background-color: #1
