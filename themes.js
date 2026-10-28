const COMMON_LOG_STYLE = `
.log-container { width: 100%; max-width: 800px; border-radius: 8px; padding: 20px !important; box-shadow: 0 4px 10px rgba(0,0,0,0.15); display: flex; flex-direction: column; gap: 12px; font-family: sans-serif; margin: 20px auto; box-sizing: border-box; }
.chat-row { display: flex; align-items: flex-start; position: relative; width: 100%; box-sizing: border-box; } 
.avatar-box { width: 64px; height: 64px; margin-right: 15px; flex-shrink: 0; border-radius: 8px; overflow: hidden; position: relative; isolation: isolate; -webkit-mask-image: -webkit-radial-gradient(white, black); }
.avatar-box img { width: 100%; height: 100%; object-fit: contain; display: block; }
.text-wrap { display: flex; flex-direction: column; flex-grow: 1; padding-right: clamp(0px, calc((100% - 560px) * 999), 60px); min-width: 0; } 
.char-name { font-weight: bold; font-size: 14px; margin-bottom: 6px; display: block; }
.bubbles-container { display: flex; flex-direction: column; gap: 4px; width: 100%; }
p.message-bubble { border-radius: 8px; padding: 8px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; margin: 0; width: fit-content; min-width: clamp(0px, calc((420px - 100%) * 999), 100%); max-width: 100%; box-sizing: border-box; }
.narration-box { border-radius: 8px; padding: 10px 14px !important; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; text-align: center; width: 100%; box-sizing: border-box; margin: 2px 0; }
.tab-tag { position: absolute; top: 2px; right: 2px; display: inline-block; padding: 2px 6px; font-size: 10px; border-radius: 4px; background-color: #333 !important; color: #aaa !important; }
/* [v4.8] 로그 칸이 좁을 때(휴대폰 등)만 말풍선이 오른쪽 끝까지 채워짐.
   위의 .text-wrap padding-right 와 p.message-bubble min-width 의 clamp(...) 가 그 역할을 함.
   @media 같은 조건문을 쓰지 않아서, 블로그가 조건문을 지워도 작동함 */
`;

const THEME_STYLES = {
    dark: {
        bodyBg: "#121212",
        containerBg: "#1e1e1e",
        bubbleBg: "#141414",
        diceBg: "#2a2a2a",
        narrationBg: "#2d2d2d",
        textMain: "#e0e0e0",
        textBubble: "#dddddd",
        textNarration: "#ffffff",
        textDice: "#ffffff"
    },
    light: {
        bodyBg: "#f0f2f5",
        containerBg: "#ffffff",
        bubbleBg: "#f1f3f5",
        diceBg: "#e9ecef",
        narrationBg: "#e2e6ea",
        textMain: "#212529",
        textBubble: "#343a40",
        textNarration: "#1a1d20",
        textDice: "#1a1d20"
    }
    // 나중에 '세피아 모드', '사이버펑크 모드' 등을 복사-붙여넣기로 쉽게 추가 가능!
};
