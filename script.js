let generatedHtmlBody = ""; 
let scraperLogs = []; // 확장 프로그램 창고에서 꺼내온 데이터가 담길 곳

// 🎯 1. 페이지 로드 시 확장 프로그램 창고에서 데이터를 꺼내오는 파트
document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["ccfolia_scraped_data"], (result) => {
            const receivedData = result.ccfolia_scraped_data;
            
            if (receivedData) {
                try {
                    const parsed = JSON.parse(receivedData);
                    scraperLogs = Object.values(parsed);
                    statusDiv.innerText = "✅ 확장 프로그램 데이터 연동 완료! 파일을 업로드해 주세요.";
                    statusDiv.style.color = "#4caf50";
                    
                    // 다음 연동을 위해 창고 비우기
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
        statusDiv.innerText = "ℹ️ 확장 프로그램을 통해 코코포리아 룸에서 데이터를 전송한 뒤 이용해 주세요.";
        statusDiv.style.color = "#2196f3";
    }
});

// 🎯 2. [미리보기 생성] 버튼 클릭 이벤트 파트
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

// 🎯 3. 백업 파일 분석 및 매칭 엔진 파트 (핵심 공장)
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

        // 💡 무적 스크래핑 맞춤형 3단계 유연한 매칭 레이어
        let matchedLog = scraperLogs.find(log => {
            if (!log || log.used) return false;
            const cleanScrapKey = getPureKey(log.matchKey || log.textContent);
            return log.name === fileName && cleanScrapKey === fileMatchKey;
        });

        if (!matchedLog) {
            matchedLog = scraperLogs.find(log => {
                if (!log || log.used) return false;
                const cleanScrapKey = getPureKey(log.matchKey || log.textContent);
                return cleanScrapKey === fileMatchKey;
            });
        }

        if (!matchedLog) {
            matchedLog = scraperLogs.find(log => {
                if (!log) return false;
                return log.name === fileName;
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

// 🎯 4. [다운로드] 버튼 클릭 이벤트 파트
document.getElementById('download-btn').addEventListener('click', () => {
    if (!generatedHtmlBody) return;

    const htmlStyles = `
    <style>
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
    </style>`;

    const finalHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>코코포리아 로그 정렬본</title>${htmlStyles}</head><body>${generatedHtmlBody}</body></html>`;

    const blob = new Blob([finalHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cocofolia_ordered_log_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});
