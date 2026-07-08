<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sori CCFolia Backup</title>
    <link rel="icon" type="image/png" href="fav.png">
    <style>
        /* ==========================================
           [1] 순정 스타일 뼈대 (한 글자도 수정 없음)
        ========================================== */
        body { background-color: #0f111a; color: #e0e0e0; font-family: sans-serif; margin: 0; padding: 0; }
        
        /* 프리뷰 영역 배치 */
        .preview-area { margin-top: 100px; padding: 20px; }
        
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
        
        p.message-bubble { position: relative; group: hover; }
        .bubble-wrapper { position: relative; display: flex; align-items: center; gap: 8px; max-width: 100%; }
        .bubble-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.2s; }
        .bubble-wrapper:hover .bubble-actions { opacity: 1; }
        
        .action-mini-btn { background: #252940; color: #8f95b2; border: 1px solid #3b4260; padding: 2px 6px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: 0.1s; }
        .action-mini-btn:hover { color: #fff; background: #4dadff; border-color: #4dadff; }
        .action-mini-btn.delete-btn:hover { background: #901a1a; border-color: #ff4d4d; color: #fff; }

        /* ==========================================
           [2] 상단 고정 툴바 구역 세련된 UI 껍데기 적용
        ========================================== */
        .toolbar { 
            position: fixed; 
            top: 0; 
            left: 0; 
            right: 0; 
            height: 80px; 
            background: rgba(24, 28, 41, 0.9); 
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            display: flex; 
            align-items: center; 
            justify-content: space-between; 
            padding: 0 40px; 
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4); 
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            z-index: 1000; 
            box-sizing: border-box;
        }
        
        .toolbar h2 { 
            margin: 0; 
            font-size: 18px; 
            font-weight: 800;
            background: linear-gradient(135deg, #4dadff, #7df9ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 2px 10px rgba(77, 173, 255, 0.2);
            letter-spacing: 0.5px;
        }
        
        .controls-group { display: flex; align-items: center; gap: 24px; }
        .control-item { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: #8f95b2; }
        .control-item strong { color: #fff; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; }
        
        select, input[type="file"] { 
            background: #1e2235; 
            color: #ffffff; 
            border: 1px solid #333955; 
            padding: 8px 14px; 
            border-radius: 6px; 
            font-size: 12px; 
            outline: none;
            transition: all 0.2s ease;
        }
        select:focus, input[type="file"]:hover { border-color: #4dadff; box-shadow: 0 0 8px rgba(77, 173, 255, 0.25); }
        select:disabled { background: #141622; color: #555a77; border-color: #222538; cursor: not-allowed; }
        
        .btn-group { display: flex; gap: 12px; }
        .btn { border: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px; transition: all 0.25s ease; display: inline-flex; align-items: center; gap: 6px; }
        
        .btn-download { background: linear-gradient(135deg, #4dadff, #2575fc); color: #ffffff; box-shadow: 0 4px 15px rgba(77, 173, 255, 0.3); }
        .btn-download:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(77, 173, 255, 0.45); }
        
        .btn-copy { background: #252940; color: #e2e8f0; border: 1px solid #3b4260; }
        .btn-copy:hover:not(:disabled) { background: #2e3454; color: #ffffff; border-color: #4dadff; }
        
        .btn:disabled { background: #1b1e2e; color: #4a4f6e; border: 1px solid #25283d; box-shadow: none; transform: none; cursor: not-allowed; }

        /* ==========================================
           [3] 우측 하단 고정형 도움말 및 패치노트 UI
        ========================================== */
        .info-panel-container {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 2000;
            font-family: 'Pretendard', sans-serif;
        }
        .info-toggle-btn {
            background: linear-gradient(135deg, #4dadff, #2575fc);
            color: #ffffff;
            border: none;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            font-size: 22px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(77, 173, 255, 0.4);
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .info-toggle-btn:hover {
            transform: scale(1.1) rotate(15deg);
            box-shadow: 0 6px 20px rgba(77, 173, 255, 0.6);
        }
        .info-card {
            position: absolute;
            bottom: 65px;
            right: 0;
            width: 350px;
            max-height: 500px;
            background: #141622;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            display: none;
            flex-direction: column;
            overflow: hidden;
            animation: fadeInUp 0.25s ease-out;
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(15px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .info-tabs {
            display: flex;
            background: #1e2235;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .info-tab-btn {
            flex: 1;
            padding: 12px;
            background: none;
            border: none;
            color: #8f95b2;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-align: center;
        }
        .info-tab-btn.active {
            color: #4dadff;
            background: #141622;
            border-bottom: 2px solid #4dadff;
        }
        .info-content-wrap {
            padding: 20px;
            overflow-y: auto;
            font-size: 13px;
            line-height: 1.6;
            color: #bcbfc4;
        }
        .info-content { display: none; }
        .info-content.active { display: block; }
        .info-content ol { margin: 0; padding-left: 18px; }
        .info-content li { margin-bottom: 8px; }
        .info-content li strong { color: #ffffff; }

        .patch-item {
            margin-bottom: 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            padding-bottom: 12px;
        }
        .patch-item:last-child { border: none; margin: 0; padding: 0; }
        .patch-version {
            font-weight: bold;
            color: #4dadff;
            font-size: 14px;
            margin-bottom: 4px;
            display: flex;
            justify-content: space-between;
        }
        .patch-date { font-size: 11px; color: #555a77; font-weight: normal; }
        .patch-item ul { margin: 4px 0 0 0; padding-left: 16px; color: #9fa3af; font-size: 12.5px; }
    </style>
</head>
<body>

    <div class="toolbar">
        <h2>Sori CCFolia Backup</h2>
        <div class="controls-group">
            <div class="control-item">
                <strong>1. 백업 파일 업로드</strong>
                <input type="file" id="html-file-picker" accept=".html,.txt">
            </div>
            <div class="control-item">
                <strong>2. 나레이션 캐릭터 지정</strong>
                <select id="narration-select" disabled>
                    <option value="">-- 파일 먼저 업로드 --</option>
                </select>
            </div>
        </div>
        <div class="btn-group">
            <button class="btn btn-copy" id="copy-btn" disabled>📋 HTML 코드 복사</button>
            <button class="btn btn-download" id="download-btn" disabled>💾 HTML 다운로드</button>
        </div>
    </div>

    <div class="preview-area">
        <div id="output-wrapper"></div>
    </div>

    <div class="info-panel-container">
        <button class="info-toggle-btn" id="info-master-btn" onclick="toggleInfoCard()">💡</button>
        
        <div class="info-card" id="info-main-card">
            <div class="info-tabs">
                <button class="info-tab-btn active" onclick="switchInfoTab(0)">📘 도움말</button>
                <button class="info-tab-btn" onclick="switchInfoTab(1)">📜 업데이트 기록</button>
            </div>
            
            <div class="info-content-wrap">
                <div class="info-content active" id="tab-content-help">
                    <ol id="help-list-target"></ol>
                </div>
                
                <div class="info-content" id="tab-content-patch">
                    <div id="patch-list-target"></div>
                </div>
            </div>
        </div>
    </div>

    <script src="info-data.js"></script>

    <script>
        // 페이지가 열릴 때 데이터를 읽어와 화면에 뿌려줌
        document.addEventListener("DOMContentLoaded", () => {
            renderHelp();
            renderPatchNotes();
        });

        function renderHelp() {
            const target = document.getElementById('help-list-target');
            target.innerHTML = HELP_DATA.map(item => `<li>${item.text}</li>`).join('');
        }

        function renderPatchNotes() {
            const target = document.getElementById('patch-list-target');
            target.innerHTML = PATCH_DATA.map(item => `
                <div class="patch-item">
                    <div class="patch-version">${item.version} <span class="patch-date">${item.date}</span></div>
                    <ul>
                        ${item.changes.map(change => `<li>${change}</li>`).join('')}
                    </ul>
                </div>
            `).join('');
        }

        function toggleInfoCard() {
            const card = document.getElementById('info-main-card');
            const btn = document.getElementById('info-master-btn');
            if (card.style.display === 'flex') {
                card.style.display = 'none';
                btn.innerText = '💡';
            } else {
                card.style.display = 'flex';
                btn.innerText = '❌';
            }
        }

        function switchInfoTab(index) {
            const tabs = document.querySelectorAll('.info-tab-btn');
            const contents = document.querySelectorAll('.info-content');
            
            tabs.forEach((tab, i) => {
                if (i === index) {
                    tab.classList.add('active');
                    contents[i].classList.add('active');
                } else {
                    tab.classList.remove('active');
                    contents[i].classList.remove('active');
                }
            });
        }
    </script>

    <script src="script.js"></script>
</body>
</html>
