let generatedHtmlBody = ""; 
let scraperLogs = []; 

const htmlStyles = `
<style>
.log-container { width: 100%; max-width: 800px; background-color: #1e1e1e; border-radius: 8px; padding: 20px !important; box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 12px; color: #e0e0e0; font-family: sans-serif; margin: 0 auto; }
.chat-row { display: flex; align-items: flex-start; position: relative; } 
.avatar-box{width:64px;height:64px;margin-right:15px;flex-shrink:0;background-color:#1a1a1a;border-radius:8px;overflow:hidden}
.avatar-box img{width:100%;height:100%;object-fit:contain}
.text-wrap { display: flex; flex-direction: column; flex-grow: 1; padding-right: 60px; } 
.char-name { font-weight: bold; font-size: 14px; margin-bottom: 6px; display: block; }
.bubbles-container { display: flex; flex-direction: column; gap: 4px; }
p.message-bubble { background-color: #141414; border-radius: 8px; padding: 8px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #dddddd; margin: 0; width: fit-content; max-width: 100%; box-sizing: border-box; margin: 0; }
.narration-box { background-color: #2d2d2d; border-radius: 8px; padding: 10px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #ffffff; text-align: center; width: 100%; box-sizing: border-box; margin: 2px 0; }
.tab-tag { position: absolute; top: 2px; right: 2px; display: inline-block; padding: 2px 6px; font-size: 10px; border-radius: 4px; background-color: #333; color: #aaa;}
</style>`;

// 페이지 로드 시 붙여넣기 감지
document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const inputArea = document.getElementById('scraper-input');

    if (inputArea) {
        inputArea.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val.includes('matchKey')) {
                try {
                    const parsed = JSON.parse(val);
                    scraperLogs = Object.values(parsed);
                    statusDiv.innerText = `✅ 확장 프로그램 데이터 연동 완료 (${scraperLogs.length}개)! 파일을 업로드해 주세요.`;
                    statusDiv.style.color = "#4caf50";
                } catch(err) {
                    statusDiv.innerText = "❌ 올바르지 않은 데이터 형식입니다.";
                    statusDiv.style.color = "#f44336";
                }
            }
        });
    }
});

// 말풍선 그룹 닫기 함수
function closeChatGroup(group) {
    let bubblesHtml = group.messages.map(msg => `<p class="message-bubble">${msg}</p>`).join('');
    const avatarHtml = group.imgUrl ? `<img src="${group.imgUrl}">` : '';
    return `<div class="chat-row">${group.tagHtml}<div class="avatar-box">${avatarHtml}</div><div class="text-wrap"><span class="char-name" style="color:${group.color}">${group.name}</span><div class="bubbles-container">${bubblesHtml}</div></div></div>`;
}

// [정렬 및 미리보기 생성] 버튼 작동
document.getElementById('preview-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('log-file');
    const narrationName = document.getElementById('narration-name').value.trim();
    const includeChatter = document.getElementById('include-chatter').checked;

    if (scraperLogs.length === 0) {
        alert("❌ 먼저 상단 박스에 확장 프로그램 데이터를 붙여넣어 주세요!");
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

// 미리보기 생성 메인 엔진
function generatePreview(fileText, narrationName, includeChatter) {
    const finalOrderedLogs = [];
    const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    const spanRegex = /<span>\s*\[([^\]]+)\]\s*<\/span>\s*<span>\s*([\s\S]*?)\s*<\/span>\s*:\s*<span>\s*([\s\S]*?)\s*<\/span>/i;

    const getPureKey = (text) => {
        if (!text) return "";
        return text.replace(/&#?[a-z0-9]+;/gi, '').replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
    };

    let match;
    while ((match = pTagRegex.exec(fileText)) !== null) {
        const pContent = match[1].trim();
        const logMatch = pContent.match(spanRegex);
        if (!logMatch) continue;

        let fileTab = logMatch[1].trim().toLowerCase(); 
        const fileName = logMatch[2].trim().replace(/<[^>]*>/g, ''); 
        let fileMessage = logMatch[3].trim().replace(/^\s+|\s+$/g, '');
        const fileMatchKey = getPureKey(fileMessage); 

        if (fileTab === 'main') fileTab = '메인';
        else if (fileTab === 'other') fileTab = '잡담';
        else if (fileTab === 'info') fileTab = '정보';

        if (!includeChatter && fileTab === '잡담') continue; 

        // 3단계 순정 매칭 레이어
        let matchedLog = scraperLogs.find(log => !log.used && log.name === fileName && getPureKey(log.matchKey) === fileMatchKey);
        if (!matchedLog) matchedLog = scraperLogs.find(log => !log.used && getPureKey(log.matchKey) === fileMatchKey);
        if (!matchedLog) matchedLog = scraperLogs.find(log => log.name === fileName);

        const isNarration = (narrationName && fileName === narrationName);
        const isSystem = (fileName === "System" || fileName === "시스템" || fileName === "system");

        if (matchedLog) {
            matchedLog.used = true; 
            finalOrderedLogs.push({ tabName: fileTab, name: matchedLog.name, imgUrl: matchedLog.imgUrl, message: fileMessage, color: matchedLog.color, isNarration: isNarration, isSystem: isSystem });
        } else {
            finalOrderedLogs.push({ tabName: fileTab, name: fileName, imgUrl: "", message: fileMessage, color: (fileName === "-" || isSystem) ? "#888888" : "#b4b4b4", isNarration: isNarration, isSystem: isSystem });
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
}

// 🎯 [HTML 파일 다운로드] 기능
document.getElementById('download-btn').addEventListener('click', () => {
    if (!generatedHtmlBody) { alert("❌ 먼저 미리보기를 생성해 주세요!"); return; }
    const finalHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>코코포리아 로그 정렬본</title>${htmlStyles}</head><body>${generatedHtmlBody}</body></html>`;
    const blob = new Blob([finalHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cocofolia_ordered_log_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
});

// 🎯 [HTML 코드 클립보드 복사] 기능 추가 완료!
document.getElementById('copy-code-btn').addEventListener('click', () => {
    if (!generatedHtmlBody) { alert("❌ 먼저 미리보기를 생성해 주세요!"); return; }
    const finalHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>코코포리아 로그 정렬본</title>${htmlStyles}</head><body>${generatedHtmlBody}</body></html>`;
    
    const tempTexarea = document.createElement("textarea");
    tempTexarea.value = finalHtml;
    document.body.appendChild(tempTexarea);
    tempTexarea.select();
    document.execCommand("copy");
    document.body.removeChild(tempTexarea);
    
    alert("✅ 완성된 HTML 코드가 클립보드에 복사되었습니다! 원하는 곳에 붙여넣으세요.");
});
