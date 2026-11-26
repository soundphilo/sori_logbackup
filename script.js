// ==========================================
// [1] 데이터 상태 관리자 (LogStore)
// ==========================================
const LogStore = {
    _logs: [],

    setLogs(newLogs, options) {
        this._logs = newLogs;
        refreshContent(options); // 데이터 변경 시 자동으로 화면 갱신
    },

    get logs() {
        return this._logs;
    }
};

// 기타 전역 상태
let globScrapedLogs = null;
let globScrapedTabs = [];           // [v4.13] 백업기가 알려준 탭 순서
let globEntriesFromScrape = false;  // [v4.13] 파일 없이 백업기 데이터만으로 만든 화면인지
let globTabChoice = new Map();      // [v4.13] 탭 이름 → 보여줄지(true/false). 기본: 잡담만 끔
let globAppliedTabKey = "";
let globNarrationTabs = new Map();  // [v4.18] 탭 이름 → 나레이션을 적용할지 (기본: 메인만 켬)
let globGroupAnchor = new Map();    // [v4.18] '따로' 탭 이름 → 이 대사(로그 id) 바로 앞에 묶어서 넣음 (없으면 맨 뒤)
let globPlacing = null;             // [v4.18][v4.19] 지금 옮기는 중인 것: { kind:'group', tab } 또는 { kind:'logs', ids:[...] }
let globSelected = new Set();       // [v4.20] 여러 개 고른 대사 id
let globLastSelected = null;        // [v4.20] Shift+클릭 범위 선택의 시작점
let globAddCounter = 0;             // [v4.20] 새로 추가한 대사 번호
let globMoves = new Map();          // [v4.19] 옮긴 대사: 대사 id → 이 대사(id) 바로 앞으로 (옮긴 순서대로 적용)
let globContextMatchCount = 0;      // [v4.18] 앞뒤 문맥으로 짝지은 줄 수
let globGuessedImgCount = 0;       // [v4.17] 짝을 못 찾아서 같은 캐릭터의 앞뒤 인장으로 채운 줄 수
let globFilledCount = 0;           // [v4.15] 파일에서 잘려서 백업기 데이터로 채운 대사 수
let globTabGrouped = new Map();     // [v4.16] 탭 이름 → true면 '따로 모아 보기', false면 '시간 순서'(다른 탭과 섞어서)
let globParsedEntries = null;       // [v4.4] 불러온 파일에서 뽑아낸 대사 목록 (파일 형식과 상관없이 같은 모양)
let globOriginFileName = "";
let globNarrationNames = new Set(); // 선택된 나레이션 캐릭터들 (여러 명 가능)
let globImageTarget = null;         // 이미지를 바꿀 대상 {scope:'block', ids:[...]} 또는 {scope:'char', name}
let globAppliedNarrationKey = "";   // [v4.6] 화면에 이미 반영된 나레이션 선택 (드롭다운을 닫을 때 비교용)
let globBlockNodes = null;          // [v4.6] 지금 화면에 있는 대사 칸들 {sig, el} (바뀐 칸만 새로 만들기 위해)

// 나레이션/이미지 목록에서 제외할 이름들
const EXCLUDED_NAMES = ["System", "system", "시스템", "알 수 없음", "-"];
const SYSTEM_NAMES = ["System", "system", "시스템"];

// ==========================================
// 캐릭터별 이미지 설정 (이름마다 한 번 정하면 저장됨)
//   zoom: 확대 배율, fx/fy: 확대할 위치(0~1), img: 바꾼 이미지
// ==========================================
const CHAR_SETTINGS_KEY = 'sori-ccfolia-char-settings';
const DEFAULT_CHAR_SETTING = { zoom: 1, fx: 0.5, fy: 0.5, img: "", nameColor: "" }; // [v4.24] nameColor: 직접 고른 이름 색
let globCharSettings = loadCharSettings();
let globSaveTimer = null;

// 캐릭터 이름 ↔ 번호 (화면에서 같은 캐릭터 이미지를 한 번에 찾기 위해 사용)
const globCharIndex = new Map();
const globCharNames = [];
function charIdx(name) {
    if (!globCharIndex.has(name)) {
        globCharIndex.set(name, globCharNames.length);
        globCharNames.push(name);
    }
    return globCharIndex.get(name);
}

function loadCharSettings() {
    try {
        return JSON.parse(localStorage.getItem(CHAR_SETTINGS_KEY)) || {};
    } catch (e) {
        return {};
    }
}

function saveCharSettingsNow() {
    clearTimeout(globSaveTimer);
    try {
        localStorage.setItem(CHAR_SETTINGS_KEY, JSON.stringify(globCharSettings));
    } catch (e) {
        // 저장 공간이 부족하면 파일로 올린 이미지만 빼고 저장
        try {
            const lite = {};
            for (const [name, s] of Object.entries(globCharSettings)) {
                lite[name] = { ...s, img: (s.img || '').startsWith('data:') ? '' : s.img };
            }
            localStorage.setItem(CHAR_SETTINGS_KEY, JSON.stringify(lite));
        } catch (e2) { /* 저장 불가 환경이면 이번 접속 동안만 유지 */ }
    }
}

// 슬라이더를 움직이는 동안에는 잠깐 모았다가 저장
function saveCharSettingsSoon() {
    clearTimeout(globSaveTimer);
    globSaveTimer = setTimeout(saveCharSettingsNow, 300);
}

function getCharSetting(name) {
    return { ...DEFAULT_CHAR_SETTING, ...(globCharSettings[name] || {}) };
}

function setCharSetting(name, patch) {
    globCharSettings[name] = { ...getCharSetting(name), ...patch };
    saveCharSettingsSoon();
}

// ==========================================
// [2] 유틸리티 및 데이터 가공 함수
// ==========================================

const getPureKey = (text) => {
    if (!text) return "";
    return text.replace(/&#?[a-z0-9]+;/gi, '').replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
};

// HTML 특수문자를 안전하게 바꿔주는 함수 (이름에 < > " 등이 들어가도 깨지지 않게)
const escapeHtml = (text) => String(text ?? "")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// 일반 글자를 화면용 HTML로 (줄바꿈은 <br>로)
const textToHtml = (text) => escapeHtml(text).replace(/\r?\n/g, '<br>');

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 선택된 나레이션 캐릭터 목록(배열)
function getSelectedNarrations() {
    return Array.from(globNarrationNames);
}

// 로그에 등장하는 캐릭터 이름 목록 (시스템 제외, 등장 순서대로)
function getCharList() {
    return Array.from(new Set(
        LogStore.logs
            .filter(log => !log.isSystem)
            .map(log => log.name)
            .filter(name => name && !EXCLUDED_NAMES.includes(name))
    ));
}

// 실제로 보여줄 이미지: 묶음별로 바꾼 이미지 > 캐릭터 전체로 바꾼 이미지 > 원래 이미지
// [v4.24] 이름 색: 설정 창에서 직접 고른 색이 있으면 그 색, 없으면 원래 색
function getNameColor(name, original) {
    return getCharSetting(name).nameColor || original;
}

function getEffectiveImg(log) {
    return log.customImg || getCharSetting(log.name).img || log.imgUrl || "";
}

// 설정 패널에 보여줄 캐릭터 대표 이미지
function getCharBaseImg(name) {
    const setting = getCharSetting(name);
    if (setting.img) return setting.img;
    const firstWithImg = LogStore.logs.find(log => log.name === name && log.imgUrl);
    return firstWithImg ? firstWithImg.imgUrl : "";
}

// ------------------------------------------
// [v4.4] 파일 안에 들어 있는 이미지(data:...)는 아주 긴 글자라서,
// 화면에는 짧은 임시 주소(blob:)로 바꿔 보여주고, 결과물을 만들 때 원래대로 되돌림
// ------------------------------------------
const globDataToBlob = new Map();
const globBlobToData = new Map();

function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const head = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const mime = (head.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
    const binary = /;base64/i.test(head) ? atob(body) : decodeURIComponent(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

function displayImgUrl(src) {
    if (!src || !src.startsWith('data:')) return src || '';
    let url = globDataToBlob.get(src);
    if (!url) {
        try {
            url = URL.createObjectURL(dataUrlToBlob(src));
        } catch (e) {
            return src;
        }
        globDataToBlob.set(src, url);
        globBlobToData.set(url, src);
    }
    return url;
}

// 로그용 스타일 생성 (테마)
// ==========================================
// [v4.22] 이름 색 자동 조절: 배경과 너무 비슷해서 안 보이는 이름 색은, 같은 색 계열에서 진하게(또는 밝게) 바꿈
// ==========================================
const globNameColors = new Map(); // 원래 이름 색 → 번호 (nc-0, nc-1 …)
function nameClass(color) {
    const key = String(color || '').trim().toLowerCase();
    if (!globNameColors.has(key)) globNameColors.set(key, globNameColors.size);
    return `nc-${globNameColors.get(key)}`;
}
function parseColor(text) {
    const t = String(text || '').trim().toLowerCase();
    let m = t.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map(ch => ch + ch).join('');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = t.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
}
function luminance([r, g, b]) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h /= 6;
    }
    return [h, s, l];
}
function hslToRgb([h, s, l]) {
    if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}
const toHex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
// 이 테마 배경에서 잘 보이는 이름 색 (잘 보이면 원래 색 그대로)
function readableNameColor(color, themeName) {
    const rgb = parseColor(color);
    const bg = parseColor((THEME_STYLES[themeName] || THEME_STYLES.dark).containerBg);
    if (!rgb || !bg) return color;
    // [v4.23] 거의 안 보일 때만 바꿈 (예: 흰 배경에 거의 흰색). 갈색·진한 빨강·보라처럼 그럭저럭 보이는 색은 그대로 둠
    const NEARLY_INVISIBLE = 1.5;
    const MIN = 3; // 바꿀 때는 이 정도는 보이게
    if (contrast(rgb, bg) >= NEARLY_INVISIBLE) return color;
    const [h, s, l0] = rgbToHsl(rgb);
    const darker = luminance(bg) > 0.5; // 밝은 배경이면 진하게, 어두운 배경이면 밝게
    let l = l0;
    for (let k = 0; k < 40; k++) {
        l = darker ? Math.max(0, l - 0.025) : Math.min(1, l + 0.025);
        const cand = hslToRgb([h, s, l]);
        if (contrast(cand, bg) >= MIN + 0.5) return toHex(cand);
    }
    return toHex(hslToRgb([h, s, l]));
}
function nameColorCss(themeName, prefix = '') {
    let css = '';
    globNameColors.forEach((i, color) => {
        const c = readableNameColor(color, themeName);
        if (c !== color) css += `${prefix}.nc-${i} { color: ${c} !important; }\n`;
    });
    return css;
}

function getLogStyles(themeName) {
    const colors = THEME_STYLES[themeName] || THEME_STYLES.dark;
    return `
    <style>
        ${COMMON_LOG_STYLE}
        .log-container { background-color: ${colors.containerBg} !important; color: ${colors.textMain} !important; }
        .avatar-box { background-color: ${colors.bubbleBg} !important; }
        p.message-bubble { background-color: ${colors.bubbleBg} !important; color: ${colors.textBubble} !important; }
        p.message-bubble.dice-bubble { background-color: ${colors.diceBg} !important; color: ${colors.textDice} !important; }
        .narration-box { background-color: ${colors.narrationBg} !important; color: ${colors.textNarration} !important; }
        ${nameColorCss(themeName)}
    </style>`;
}

// [v4.22] 미리보기의 테마 스타일을 지금 상태로 다시 넣음 (새 이름 색이 생겼을 때 등)
function refreshPreviewStyle() {
    const oldStyle = document.querySelector('#output-wrapper > style');
    if (!oldStyle) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = getLogStyles(document.getElementById('theme-select').value || 'dark').trim();
    oldStyle.replaceWith(tpl.content.firstElementChild);
}

// 프리뷰 자리에 안내 문구 표시
function showStatus(message) {
    document.getElementById('output-wrapper').innerHTML = `<h3 class="status-message">${message}</h3>`;
    document.getElementById('copy-btn').disabled = true;
    document.getElementById('download-btn').disabled = true;
}

// ==========================================
// [3] 이미지 크기·확대·위치 적용
// ==========================================

// 확대할 때 기준점(transform-origin)을 계산.
// 이미지가 칸 안에 비율대로 들어가 있으므로, 이미지 기준 위치(fx, fy)를 칸 기준 위치로 바꿔줌
// [v4.10] 확대 방식 변경: 이미지를 작게 그린 뒤 "돋보기처럼 키우는" 방식(transform)은 흐려짐.
// 대신 이미지를 처음부터 확대된 크기로 그리고 위치만 옮겨서, 원본 화질 그대로 보이게 함.
// 모든 값은 칸 크기에 대한 % 라서, 칸 크기를 바꿔도 그대로 맞음
function computeImgStyle(setting, natW, natH) {
    // [v4.12] 블로그마다 이미지에 자체 스타일(max-width:100% 등)을 강제로 거는 경우가 있어서,
    // 모든 값에 !important 를 붙이고 위치는 position 대신 margin 으로 잡음 (블로그에서 지워지거나 덮이지 않게)
    const base = 'display:block!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;'
        + 'padding:0!important;border:0!important;box-shadow:none!important;border-radius:0!important;';
    const zoom = setting.zoom || 1;
    if (zoom <= 1.001) {
        return base + 'width:100%!important;height:100%!important;margin:0!important;object-fit:contain!important;';
    }
    let aw = 1, ah = 1;
    if (natW && natH) {
        if (natW < natH) aw = natW / natH;
        else ah = natH / natW;
    }
    // 확대 기준점 (칸 기준 %)
    const ox = ((1 - aw) / 2 + setting.fx * aw) * 100;
    const oy = ((1 - ah) / 2 + setting.fy * ah) * 100;
    // 확대 전 이미지의 왼쪽·위 위치 (칸 기준 %)
    const left0 = (1 - aw) / 2 * 100;
    const top0 = (1 - ah) / 2 * 100;
    const w = aw * zoom * 100;
    const h = ah * zoom * 100;
    const left = ox + zoom * (left0 - ox);
    const top = oy + zoom * (top0 - oy);
    // 이미지 칸은 정사각형이라 margin-top % 도 가로 기준으로 계산해도 같음
    return base + 'object-fit:fill!important;'
        + `width:${w.toFixed(3)}%!important;height:${h.toFixed(3)}%!important;`
        + `margin:${top.toFixed(3)}% 0 0 ${left.toFixed(3)}%!important;`;
}

// 이미지 칸 하나에 크기/확대/위치를 입힘 (인라인 스타일이라 복사·다운로드 결과물에도 그대로 남음)
// [v4.7] 이미지 원본 크기 기억 (주소별). 이미지가 늦게 불러와져도 확대 위치가 어긋나지 않게 하기 위함
const globImgSize = new Map();

function rememberImgSize(src, w, h) {
    if (src && w && h) globImgSize.set(src, { w, h });
}

// 파일을 읽자마자 이미지 크기를 미리 알아 둠
function preloadImageSizes(urls) {
    new Set(urls.map(displayImgUrl).filter(Boolean)).forEach(src => {
        if (globImgSize.has(src)) return;
        const probe = new Image();
        probe.onload = () => {
            rememberImgSize(src, probe.naturalWidth, probe.naturalHeight);
            restyleImagesWithSrc(src);
        };
        probe.src = src;
    });
}

// 같은 이미지를 쓰는 칸들의 확대 위치를 다시 계산
function restyleImagesWithSrc(src) {
    document.querySelectorAll('.avatar-box[data-char-idx] img').forEach(img => {
        if (img.getAttribute('src') !== src) return;
        const box = img.closest('.avatar-box');
        styleAvatarBox(box, getCharSetting(globCharNames[box.dataset.charIdx]));
    });
}

function styleAvatarBox(box, setting) {
    // [v4.12] 이미지 칸 크기는 고정 (예전에 저장된 크기 설정이 있어도 무시)
    box.style.removeProperty('width');
    box.style.removeProperty('height');
    const img = box.querySelector('img');
    if (!img) return;
    const src = img.getAttribute('src');
    if (img.complete && img.naturalWidth) rememberImgSize(src, img.naturalWidth, img.naturalHeight);
    const size = globImgSize.get(src);
    img.setAttribute('style', computeImgStyle(setting, size && size.w, size && size.h));
    if (!size) {
        // 아직 크기를 모르면, 불러온 뒤에 다시 계산
        img.addEventListener('load', () => {
            rememberImgSize(src, img.naturalWidth, img.naturalHeight);
            img.setAttribute('style', computeImgStyle(getCharSetting(globCharNames[box.dataset.charIdx]) || setting, img.naturalWidth, img.naturalHeight));
        }, { once: true });
    }
}

// 영역 안의 모든 이미지 칸에 설정 적용
function styleAvatarsIn(root) {
    root.querySelectorAll('.avatar-box[data-char-idx]').forEach(box => {
        const name = globCharNames[box.dataset.charIdx];
        styleAvatarBox(box, getCharSetting(name));
    });
}

// 한 캐릭터의 이미지 칸(프리뷰 + 설정 패널)을 화면 전체를 다시 그리지 않고 바로 갱신
function updateCharAvatars(name) {
    const setting = getCharSetting(name);
    document.querySelectorAll(`.avatar-box[data-char-idx="${charIdx(name)}"]`)
        .forEach(box => styleAvatarBox(box, setting));
}

// ==========================================
// [4] 이미지 바꾸기
// ==========================================

// 내 컴퓨터의 이미지 파일을 읽어서 결과물에 넣을 수 있는 형태로 변환 (너무 크면 600px로 줄임)
function readImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('decode'));
            img.onload = () => {
                const MAX = 1200; // [v4.10] 확대해도 덜 깨지도록 600 → 1200
                const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                if (scale === 1 && file.size < 300 * 1024) return resolve(reader.result);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                let out = canvas.toDataURL('image/webp', 0.9);
                if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png');
                resolve(out);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// 이미지 주소(URL)를 입력받음
function askImageUrl() {
    const url = prompt("🔗 바꿀 이미지의 주소(URL)를 붙여넣어 주세요:", "");
    if (url === null) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (!/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
        alert("http:// 또는 https:// 로 시작하는 이미지 주소를 넣어 주세요.");
        return null;
    }
    return trimmed;
}

// 대상(묶음 또는 캐릭터 전체)에 새 이미지 적용. src가 ""이면 원래 이미지로 되돌림
function applyImageToTarget(target, src) {
    if (!target) return;
    if (target.scope === 'block') {
        LogStore.setLogs(LogStore.logs.map(log =>
            target.ids.includes(log.id) ? { ...log, customImg: src } : log
        ));
    } else if (target.scope === 'char') {
        setCharSetting(target.name, { img: src });
        saveCharSettingsNow();
        refreshContent();
    }
    if (isImagePanelOpen()) renderImagePanel();
}

// 파일 선택창 열기
function pickImageFileFor(target) {
    globImageTarget = target;
    document.getElementById('image-file-picker').click();
}

// 프리뷰의 🖼 버튼을 누르면 나오는 작은 메뉴
function openAvatarMenu(button, ids) {
    const menu = document.getElementById('avatar-menu');
    globImageTarget = { scope: 'block', ids };
    const rect = button.getBoundingClientRect();
    menu.classList.add('open');
    const menuW = menu.offsetWidth || 190;
    const menuH = menu.offsetHeight || 150;
    let top = rect.bottom + 6;
    if (top + menuH > window.innerHeight) top = Math.max(8, rect.top - menuH - 6);
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 8))}px`;
    menu.style.top = `${top}px`;
}

function closeAvatarMenu() {
    document.getElementById('avatar-menu').classList.remove('open');
}

// ==========================================
// [5] 캐릭터 이미지 설정 패널
// ==========================================

function isImagePanelOpen() {
    return document.getElementById('image-panel').classList.contains('open');
}

function renderImagePanel() {
    const list = document.getElementById('image-panel-list');
    const names = getCharList();
    if (names.length === 0) {
        list.innerHTML = `<p class="panel-hint">파일을 먼저 업로드해 주세요.</p>`;
        return;
    }

    list.innerHTML = names.map(name => {
        const setting = getCharSetting(name);
        const idx = charIdx(name);
        const img = displayImgUrl(getCharBaseImg(name));
        const originalColor = (LogStore.logs.find(log => log.name === name) || {}).color || '#ffffff';
        const color = getNameColor(name, originalColor);
        const colorHex = toHex(parseColor(color) || [255, 255, 255]);
        const zoomPct = Math.round(setting.zoom * 100);

        const pickerHtml = img
            ? `<div class="focus-picker" title="확대해서 보여줄 위치를 클릭하거나 끌어서 정하세요">
                   <img src="${escapeHtml(img)}" alt="">
                   <span class="focus-dot" style="left:${setting.fx * 100}%; top:${setting.fy * 100}%;"></span>
               </div>`
            : `<div class="no-image">이미지 없음</div>`;

        return `
        <div class="char-card" data-char-idx="${idx}">
            <div class="char-card-head">
                <span class="char-card-name" style="color:${color}">${escapeHtml(name)}</span>
                <button type="button" class="mini-link" data-action="reset">원래대로</button>
            </div>
            <div class="char-card-main">
                ${pickerHtml}
                <div class="char-card-result">
                    <span>결과 미리보기</span>
                    <div class="avatar-box" data-char-idx="${idx}">${img ? `<img src="${escapeHtml(img)}" alt="">` : ''}</div>
                </div>
            </div>
            <div class="panel-slider-row">
                <label>확대 <span class="val" data-val="zoom">${zoomPct}%</span></label>
                <input type="range" data-field="zoom" min="100" max="400" step="10" value="${zoomPct}">
            </div>
            <div class="name-color-row">
                <label>이름 색</label>
                <input type="color" data-field="nameColor" value="${colorHex}">
                <span class="val">${setting.nameColor ? '직접 고름' : '원래 색'}</span>
                ${setting.nameColor ? `<button type="button" class="mini-link" data-action="name-color-reset">원래 색으로</button>` : ''}
            </div>
            <div class="char-card-btns">
                <button type="button" class="panel-btn" data-action="file">📁 파일로 변경</button>
                <button type="button" class="panel-btn" data-action="url">🔗 URL로 변경</button>
            </div>
        </div>`;
    }).join('');

    styleAvatarsIn(list);
}

// 확대 위치 점을 클릭/드래그한 곳으로 옮김
function setFocusFromPointer(picker, event) {
    const card = picker.closest('.char-card');
    const name = globCharNames[card.dataset.charIdx];
    const rect = picker.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fx = clamp01((event.clientX - rect.left) / rect.width);
    const fy = clamp01((event.clientY - rect.top) / rect.height);

    const patch = { fx, fy };
    // 확대가 100%면 위치를 골라도 변화가 없으니 자동으로 200%로 올려줌
    if (getCharSetting(name).zoom <= 1.001) {
        patch.zoom = 2;
        card.querySelector('input[data-field="zoom"]').value = 200;
        card.querySelector('[data-val="zoom"]').textContent = '200%';
    }
    setCharSetting(name, patch);

    const dot = picker.querySelector('.focus-dot');
    dot.style.left = `${fx * 100}%`;
    dot.style.top = `${fy * 100}%`;
    updateCharAvatars(name);
}

// ==========================================
// [6] 나레이션 다중 선택 드롭다운
// ==========================================

function populateNarrationDropdown() {
    const menu = document.getElementById('dropdown-menu');
    const btn = document.getElementById('dropdown-btn');
    if (!menu || !btn) return;

    const uniqueNames = getCharList();

    // 새 파일에 없는 이름은 선택 목록에서 정리
    globNarrationNames = new Set([...globNarrationNames].filter(name => uniqueNames.includes(name)));

    if (uniqueNames.length === 0) {
        menu.innerHTML = `<div class="dropdown-empty">선택할 수 있는 캐릭터가 없습니다</div>`;
    } else {
        menu.innerHTML = uniqueNames.map(name => `
            <label class="dropdown-item">
                <input type="checkbox" value="${escapeHtml(name)}" ${globNarrationNames.has(name) ? 'checked' : ''}>
                <span>${escapeHtml(name)}</span>
            </label>`).join('') + `<div class="dropdown-hint">다 고른 뒤 바깥을 누르면 적용돼요</div>`;
    }

    btn.disabled = false;
    updateDropdownLabel();
}

// ==========================================
// [v4.13] 탭 선택 — 모든 탭을 불러와 두고, 고른 탭만 화면·결과물에 보여줌
// ==========================================

// 로그에 있는 탭 목록 (메인 → 백업기 탭 순서 → 처음 나온 순서)
function getTabList() {
    const seen = [];
    LogStore.logs.forEach(log => { if (!seen.includes(log.tabName)) seen.push(log.tabName); });
    const order = ['메인', ...globScrapedTabs.map(normalizeTab)];
    return seen.sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || seen.indexOf(a) - seen.indexOf(b);
    });
}

// [v4.16][v4.18] 나레이션 캐릭터는 '나레이션'을 켠 탭에서만 나레이션으로, 나머지 탭에서는 일반 대화로 보여줌
//   기본값: 메인 탭만 켬. '5. 탭 선택'에서 탭마다 바꿀 수 있음
function isNarrationTab(tabName) {
    if (!globNarrationTabs.has(tabName)) return tabName === '메인';
    return globNarrationTabs.get(tabName);
}
function isNarrationFor(name, tabName, isSystem, narrationNames) {
    return !isSystem && isNarrationTab(tabName) && narrationNames.includes(name);
}

// [v4.16] 탭을 따로 모아 볼지 (백업기 데이터만 있으면 시간 순서를 알 수 없어서 항상 따로)
function isTabGrouped(tabName) {
    if (globEntriesFromScrape) return true;
    return globTabGrouped.get(tabName) === true;
}

function isTabShown(tabName) {
    if (!globTabChoice.has(tabName)) globTabChoice.set(tabName, tabName !== '잡담'); // 처음 보는 탭: 잡담만 빼고 켬
    return globTabChoice.get(tabName);
}

function tabKey() {
    return getTabList().map(tab => `${tab}:${isTabShown(tab) ? 1 : 0}${isTabGrouped(tab) ? 1 : 0}${isNarrationTab(tab) ? 1 : 0}`).join('\u0001');
}

// [v4.16] 탭마다 '시간순 / 따로' 버튼 글자
function orderToggleHtml(tab) {
    const grouped = isTabGrouped(tab);
    return `<button type="button" class="order-toggle ${grouped ? 'grouped' : ''}" data-tab="${escapeHtml(tab)}" ${globEntriesFromScrape ? 'disabled title="시간 순서는 로그 파일이 있어야 쓸 수 있어요"' : ''}>${grouped ? '따로' : '시간순'}</button>`;
}

function populateTabDropdown() {
    const menu = document.getElementById('tab-dropdown-menu');
    const btn = document.getElementById('tab-dropdown-btn');
    if (!menu || !btn) return;
    const tabs = getTabList();
    const counts = {};
    LogStore.logs.forEach(log => { counts[log.tabName] = (counts[log.tabName] || 0) + 1; });

    menu.innerHTML = tabs.length === 0
        ? `<div class="dropdown-empty">탭이 없습니다</div>`
        : tabs.map(tab => `
            <div class="dropdown-item tab-row">
                <label class="tab-check">
                    <input type="checkbox" value="${escapeHtml(tab)}" ${isTabShown(tab) ? 'checked' : ''}>
                    <span>${escapeHtml(tab)}</span>
                </label>
                <span class="dropdown-count">${counts[tab]}</span>
                ${orderToggleHtml(tab)}
                <button type="button" class="narr-toggle ${isNarrationTab(tab) ? 'on' : ''}" data-tab="${escapeHtml(tab)}" title="이 탭에서 나레이션 캐릭터를 나레이션으로 보여줄지">나레이션 ${isNarrationTab(tab) ? '켬' : '끔'}</button>
            </div>`).join('') + `<div class="dropdown-hint">체크: 보여줄 탭 · 시간순: 다른 탭과 섞어서 · 따로: 한 덩어리로 묶어서<br>나레이션 켬: 이 탭에서도 나레이션 캐릭터를 나레이션으로<br>다 고른 뒤 바깥을 누르면 적용돼요</div>`;
    btn.disabled = tabs.length === 0;
    updateTabDropdownLabel();
    globAppliedTabKey = tabKey();
}

function updateTabDropdownLabel() {
    const label = document.getElementById('tab-dropdown-label');
    if (!label) return;
    const tabs = getTabList();
    const shown = tabs.filter(isTabShown);
    if (shown.length === tabs.length) label.textContent = '전체 탭';
    else if (shown.length === 0) label.textContent = '선택 안 함';
    else if (shown.length <= 2) label.textContent = shown.join(', ');
    else label.textContent = `${shown[0]} 외 ${shown.length - 1}개`;
}

// [v4.14][v4.16] 순서 선택칸 상태 맞추기: 모든 탭이 시간순이면 '시간 순서', 모두 따로면 '탭별로 모아 보기', 섞여 있으면 '탭마다 다르게'
function updateOrderSelect() {
    const select = document.getElementById('order-select');
    if (!select) return;
    const timeOption = select.querySelector('option[value="time"]');
    if (globEntriesFromScrape) {
        timeOption.disabled = true;
        timeOption.textContent = '시간 순서 (로그 파일 필요)';
    } else {
        timeOption.disabled = false;
        timeOption.textContent = '시간 순서';
    }
    const tabs = getTabList();
    const groupedCount = tabs.filter(isTabGrouped).length;
    select.value = groupedCount === 0 ? 'time' : groupedCount === tabs.length ? 'tab' : 'mixed';
    select.disabled = LogStore.logs.length === 0;
}

function closeTabDropdown() {
    const dropdown = document.getElementById('tab-dropdown');
    if (!dropdown || !dropdown.classList.contains('open')) return;
    dropdown.classList.remove('open');
    const key = tabKey();
    if (key !== globAppliedTabKey) {
        globAppliedTabKey = key;
        updateOrderSelect();
        applyNarrationToLogs(); // 탭별 나레이션 설정까지 반영해서, 바뀐 칸만 새로 그림
    }
}

function updateDropdownLabel() {
    const label = document.getElementById('dropdown-label');
    if (!label) return;
    const names = getSelectedNarrations();
    if (names.length === 0) label.textContent = '선택 안 함';
    else if (names.length <= 2) label.textContent = names.join(', ');
    else label.textContent = `${names[0]} 외 ${names.length - 1}명`;
}

function applyNarrationToLogs() {
    const narrationNames = getSelectedNarrations();
    const updated = LogStore.logs.map(log => {
        if (!log.isSystem && log.name !== "-") {
            const isNarration = isNarrationFor(log.name, log.tabName, log.isSystem, narrationNames);
            return log.isNarration === isNarration ? log : { ...log, isNarration };
        }
        return log;
    });
    LogStore.setLogs(updated, { incremental: true }); // [v4.6] 바뀐 캐릭터의 대사 칸만 새로 그림
}

// [v4.6] 지금 고른 나레이션 목록을 비교용 글자로
function narrationKey() {
    return getSelectedNarrations().slice().sort().join('\u0001');
}

// [v4.6] 드롭다운을 닫고, 선택이 바뀌었으면 그때 한 번에 반영
function closeNarrationDropdown() {
    const dropdown = document.getElementById('narration-dropdown');
    if (!dropdown || !dropdown.classList.contains('open')) return;
    dropdown.classList.remove('open');
    const key = narrationKey();
    if (key !== globAppliedNarrationKey) {
        globAppliedNarrationKey = key;
        applyNarrationToLogs();
    }
}

// ==========================================
// [7] [v4.4] 파일 읽기 — 형식을 자동으로 알아내서 같은 모양의 대사 목록으로 바꿈
//   대사 하나 = { tabName, name, message(HTML), color, imgUrl, time, isSystem }
// ==========================================

// 탭 이름 통일 (main → 메인 등)
const TAB_ALIASES = {
    main: '메인', other: '잡담', info: '정보',
    'メイン': '메인', '雑談': '잡담', '情報': '정보'
};
function normalizeTab(raw) {
    const t = String(raw || '').trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    if (!t) return '메인';
    return TAB_ALIASES[t.toLowerCase()] || TAB_ALIASES[t] || t;
}
const isBasicChannel = (ch) => ['main', 'other', 'info'].includes(String(ch || '').toLowerCase());

// ① 예전 코코포리아 HTML ([main], [all] 등): <p><span>[main]</span><span>이름</span> : <span>대사</span></p>
function parseClassicHtml(text) {
    const entries = [];
    const pTagRegex = /<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi;
    const spanRegex = /<span>\s*\[([^\]]+)\]\s*<\/span>\s*<span>\s*([\s\S]*?)\s*<\/span>\s*:\s*<span>\s*([\s\S]*?)\s*<\/span>/i;
    const colorRegex = /color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/i;

    let match;
    while ((match = pTagRegex.exec(text)) !== null) {
        const logMatch = match[2].trim().match(spanRegex);
        if (!logMatch) continue;
        const name = logMatch[2].trim().replace(/<[^>]*>/g, '');
        const message = logMatch[3].trim();
        if (!message) continue; // 지워져서 비어 있는 대사는 건너뜀
        const colorMatch = (match[1] || '').match(colorRegex);
        entries.push({
            tabName: normalizeTab(logMatch[1]),
            name,
            message,
            color: colorMatch ? colorMatch[1] : '',
            imgUrl: '',
            time: null,
            isSystem: SYSTEM_NAMES.includes(name)
        });
    }
    return entries;
}

// ② 새 코코포리아 HTML (ZIP 안의 파일 등): <article class="message"> ... 이미지가 파일 안에 들어 있음
function parseRichHtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');

    // 스타일 안에 적힌 캐릭터 이미지 목록 (.avatar-image-0 { background-image: url("...") })
    const avatarMap = {};
    const styleText = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
    const imgRegex = /\.(avatar-image-[\w-]+)\s*\{[^}]*?url\(\s*["']?([^"')]+)["']?\s*\)/g;
    let m;
    while ((m = imgRegex.exec(styleText)) !== null) avatarMap[m[1]] = m[2];

    return Array.from(doc.querySelectorAll('article.message')).map(article => {
        const isSystem = article.classList.contains('system');
        const speakerEl = article.querySelector('.speaker');
        const name = isSystem ? 'system' : (speakerEl ? speakerEl.textContent.trim() : '');
        const colorMatch = ((speakerEl && speakerEl.getAttribute('style')) || '').match(/--speaker-color\s*:\s*([^;]+)/);

        let imgUrl = '';
        const avatarEl = article.querySelector('.avatar');
        if (avatarEl) {
            const cls = Array.from(avatarEl.classList).find(c => avatarMap[c]);
            if (cls) imgUrl = avatarMap[cls];
            else {
                const inline = (avatarEl.getAttribute('style') || '').match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
                if (inline) imgUrl = inline[1];
            }
        }

        const textEl = article.querySelector('.message-text');
        const rollEl = article.querySelector('.roll-result');
        let message = textToHtml(textEl ? textEl.textContent.trim() : '');
        const roll = rollEl ? rollEl.textContent.trim() : '';
        if (roll) message = message ? `${message} ${textToHtml(roll)}` : textToHtml(roll);

        const channel = article.getAttribute('data-channel') || '';
        const channelNameEl = article.querySelector('.channel-name');
        const tabName = isBasicChannel(channel) ? normalizeTab(channel)
            : normalizeTab((channelNameEl && channelNameEl.textContent) || channel);

        const timeEl = article.querySelector('time[datetime]');
        const time = timeEl ? Date.parse(timeEl.getAttribute('datetime')) : null;

        return {
            tabName, name, message,
            color: colorMatch ? colorMatch[1].trim() : '',
            imgUrl,
            time: Number.isFinite(time) ? time : null,
            isSystem
        };
    }).filter(entry => entry.message);
}

// ③ 코코포리아 JSON: { messages: [...], images: { 번호: "data:image/..." } }
function parseJsonLog(text) {
    const data = JSON.parse(text);
    const messages = Array.isArray(data) ? data : (data.messages || []);
    const images = (data && data.images) || {};

    return messages.map(msg => {
        const isSystem = msg.type === 'system' || SYSTEM_NAMES.includes(msg.name);
        let message = textToHtml(String(msg.text ?? '').trim());
        const roll = msg.extend && msg.extend.roll;
        if (roll && roll.result) {
            message = message ? `${message} ${textToHtml(roll.result)}` : textToHtml(roll.result);
        }

        const icon = msg.iconImage;
        const imgUrl = icon ? (images[icon] || (/^(https?:|data:)/.test(icon) ? icon : '')) : '';
        const tabName = isBasicChannel(msg.channel) ? normalizeTab(msg.channel)
            : normalizeTab(msg.channelName || msg.channel);

        return {
            tabName,
            name: isSystem ? 'system' : String(msg.name || ''),
            message,
            color: msg.color || '',
            imgUrl,
            time: typeof msg.createdAt === 'number' ? msg.createdAt : null,
            isSystem
        };
    }).filter(entry => entry.message);
}

// 글자 내용을 보고 어떤 형식인지 판단해서 알맞게 읽음
function parseLogText(text) {
    const head = text.replace(/^﻿/, '').trimStart();
    if (head.startsWith('{') || head.startsWith('[')) return parseJsonLog(head);
    if (/<article[^>]*class="[^"]*\bmessage\b/i.test(text)) return parseRichHtml(text);
    return parseClassicHtml(text);
}

// 여러 파일(ZIP 안의 [전체]/[메인]/[잡담] 등)을 하나로 합침. 같은 대사는 한 번만
function mergeEntryLists(lists) {
    const nonEmpty = lists.filter(list => list.length);
    if (nonEmpty.length === 0) return [];
    if (nonEmpty.length === 1) return nonEmpty[0];

    const allTimed = nonEmpty.every(list => list.every(entry => entry.time !== null));
    if (!allTimed) {
        // 시간 정보가 없으면 가장 대사가 많은 파일을 사용
        return nonEmpty.reduce((a, b) => (b.length > a.length ? b : a));
    }

    const keyOf = (e) => `${e.time}|${e.tabName}|${e.name}|${e.message}`;
    const maxCount = new Map();
    nonEmpty.forEach(list => {
        const counts = new Map();
        list.forEach(e => counts.set(keyOf(e), (counts.get(keyOf(e)) || 0) + 1));
        counts.forEach((c, k) => maxCount.set(k, Math.max(maxCount.get(k) || 0, c)));
    });

    const used = new Map();
    const merged = [];
    nonEmpty.forEach(list => list.forEach(e => {
        const key = keyOf(e);
        if ((used.get(key) || 0) < maxCount.get(key)) {
            used.set(key, (used.get(key) || 0) + 1);
            merged.push(e);
        }
    }));
    return merged.map((e, i) => ({ e, i }))
        .sort((a, b) => (a.e.time - b.e.time) || (a.i - b.i))
        .map(x => x.e);
}

// ZIP 파일 안의 로그 파일들을 모두 읽어서 합침
async function parseZip(arrayBuffer) {
    if (typeof JSZip === 'undefined') throw new Error('NO_JSZIP');
    const zip = await JSZip.loadAsync(arrayBuffer);
    const files = Object.values(zip.files).filter(f => !f.dir && /\.(html?|json)$/i.test(f.name));
    const lists = [];
    for (const f of files) {
        try {
            lists.push(parseLogText(await f.async('string')));
        } catch (e) { /* 읽을 수 없는 파일은 건너뜀 */ }
    }
    return mergeEntryLists(lists);
}

// [v4.13] 파일 없이 백업기 데이터만으로 대사 목록 만들기 (탭별로 이어서, 탭 안에서는 순서대로)
function entriesFromScrape() {
    const logs = Object.values(globScrapedLogs || {});
    return logs
        .map((log, i) => ({ log, i }))
        .sort((a, b) => ((a.log.tabOrder || 0) - (b.log.tabOrder || 0)) || ((a.log.index || 0) - (b.log.index || 0)) || (a.i - b.i))
        .map(({ log }) => ({
            tabName: normalizeTab(log.tabName),
            name: log.name,
            message: textToHtml(log.message),
            color: log.color || '',
            imgUrl: log.imgUrl || '',
            time: null,
            isSystem: !!log.isSystem || SYSTEM_NAMES.includes(log.name)
        }));
}

// 읽어 온 대사 목록 → 화면에 쓸 로그로 변환 (코코포리아 수집 데이터가 있으면 이미지를 짝지어 줌)
// [v4.18] 두 글자 묶음이 얼마나 겹치는지 (0~1). 글자가 조금 바뀐 대사도 비슷하다고 알아봄
function textSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const grams = (t) => { const m = new Map(); for (let k = 0; k < t.length - 1; k++) { const g = t.slice(k, k + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    if (a.length < 2 || b.length < 2) return a.includes(b) || b.includes(a) ? 0.6 : 0;
    const ga = grams(a), gb = grams(b);
    let common = 0;
    ga.forEach((n, g) => { common += Math.min(n, gb.get(g) || 0); });
    return (2 * common) / (a.length - 1 + b.length - 1);
}

// [v4.18] 빈칸 안의 파일 대사(gap)와 백업기 대사(pool)를 순서를 지키며 짝지음. 짝지은 수를 돌려줌
function pairByContext(gap, pool, matches, fileKeys) {
    let count = 0;
    let from = 0;
    const sameCount = gap.length === pool.length;
    gap.forEach((i, k) => {
        const entry = globParsedEntries[i];
        let best = null, bestScore = 0, bestPos = -1;
        for (let p = from; p < pool.length; p++) {
            const item = pool[p];
            if (item.used || item.name !== entry.name) continue;
            let score = textSimilarity(fileKeys[i], item.key);
            if (sameCount && p === k) score += 0.3;  // 빈칸 크기가 같으면 같은 자리를 더 믿음
            if (score > bestScore) { best = item; bestScore = score; bestPos = p; }
        }
        if (best && bestScore >= 0.35) {
            best.used = true;
            matches[i] = best;
            from = bestPos + 1;
            count++;
        }
    });
    return count;
}

function buildLogsFromEntries() {
    if (!globParsedEntries) return 0;

    // [v4.15] 백업기 데이터를 탭별로, 긁은 순서대로 정리 (ord = 그 탭 안에서 몇 번째 대사인지)
    const scrapedByTab = new Map();
    const scrapedByKey = new Map();
    if (globScrapedLogs) {
        Object.values(globScrapedLogs)
            .map(log => ({ ...log, tabName: normalizeTab(log.tabName), used: false, key: getPureKey(log.matchKey || log.message) }))
            .sort((x, y) => ((x.tabOrder || 0) - (y.tabOrder || 0)) || ((x.index || 0) - (y.index || 0)))
            .forEach(item => {
                if (!scrapedByTab.has(item.tabName)) scrapedByTab.set(item.tabName, []);
                const list = scrapedByTab.get(item.tabName);
                item.ord = list.length;
                list.push(item);
                if (!scrapedByKey.has(item.key)) scrapedByKey.set(item.key, []);
                scrapedByKey.get(item.key).push(item);
            });
    }

    // [v4.16] 백업기가 읽은 탭 이름이 파일의 탭 이름과 다르면, 대사 내용이 가장 많이 겹치는 파일 탭으로 맞춤
    if (scrapedByTab.size && !globEntriesFromScrape) {
        const fileKeysByTab = new Map();
        globParsedEntries.forEach(entry => {
            if (!fileKeysByTab.has(entry.tabName)) fileKeysByTab.set(entry.tabName, new Set());
            fileKeysByTab.get(entry.tabName).add(getPureKey(entry.message));
        });
        [...scrapedByTab.keys()].forEach(tab => {
            if (fileKeysByTab.has(tab)) return;
            const list = scrapedByTab.get(tab);
            let bestTab = null, bestHits = 0;
            fileKeysByTab.forEach((keys, fileTab) => {
                const hits = list.filter(item => keys.has(item.key)).length;
                if (hits > bestHits) { bestHits = hits; bestTab = fileTab; }
            });
            if (bestTab && bestHits >= Math.max(3, list.length * 0.3)) {
                const target = scrapedByTab.get(bestTab) || [];
                list.forEach(item => { item.tabName = bestTab; item.ord = target.length; target.push(item); });
                scrapedByTab.set(bestTab, target);
                scrapedByTab.delete(tab);
            }
        });
    }

    // 파일 대사마다 "그 탭 안에서 몇 번째인지" 계산
    const fileKeys = globParsedEntries.map(entry => getPureKey(entry.message));
    const fileOrd = [];
    const fileCountByTab = new Map();
    globParsedEntries.forEach((entry, i) => {
        const n = fileCountByTab.get(entry.tabName) || 0;
        fileOrd[i] = n;
        fileCountByTab.set(entry.tabName, n + 1);
    });

    // [v4.15] 탭마다 파일이 백업기 데이터의 어디부터 어디까지인지 계산
    //   그 탭에서 딱 한 번만 나오는 대사(기준 대사)로 위치를 맞춤 → "…" 같은 흔한 대사에 속지 않음
    const tabRange = new Map(); // 탭 → { head: 파일보다 앞에 있는 백업기 대사 수, tailStart: 파일보다 뒤가 시작되는 위치 }
    scrapedByTab.forEach((list, tab) => {
        const keyCount = new Map();
        list.forEach(item => keyCount.set(item.key, (keyCount.get(item.key) || 0) + 1));
        const isAnchor = (key) => key.length >= 6 && keyCount.get(key) === 1;
        const indexes = [];
        globParsedEntries.forEach((entry, i) => { if (entry.tabName === tab) indexes.push(i); });
        if (indexes.length === 0) return; // 파일에 없는 탭

        const firstAnchor = indexes.find(i => isAnchor(fileKeys[i]));
        let lastAnchor = -1;
        for (let k = indexes.length - 1; k >= 0; k--) { if (isAnchor(fileKeys[indexes[k]])) { lastAnchor = indexes[k]; break; } }
        if (firstAnchor === undefined) { tabRange.set(tab, { head: 0, tailStart: list.length }); return; }

        const posOf = (i) => list.find(item => item.key === fileKeys[i]).ord;
        const head = Math.max(0, posOf(firstAnchor) - fileOrd[firstAnchor]);
        const tailStart = Math.min(list.length, posOf(lastAnchor) + (fileCountByTab.get(tab) - 1 - fileOrd[lastAnchor]) + 1);
        tabRange.set(tab, { head, tailStart });
    });

    const narrationNames = getSelectedNarrations();
    const tempLogs = [];
    const matches = [];

    // 1) 글자가 똑같은 대사끼리 짝짓기
    //   [v4.18] 같은 탭에서 '있어야 할 자리' 근처(앞뒤 40줄)에 있는 같은 대사하고만 짝지음.
    //   "진짜로?"와 "진짜로//////"처럼 기호를 빼면 같아지는 짧은 대사가 멀리 있는 엉뚱한 줄과 짝지어지는 걸 막음.
    //   자리를 놓치면, 그 탭에서 딱 한 번만 나오는 대사로 다시 자리를 맞춤.
    const keyCountByTab = new Map();
    scrapedByTab.forEach((list, tab) => {
        const m = new Map();
        list.forEach(item => m.set(item.key, (m.get(item.key) || 0) + 1));
        keyCountByTab.set(tab, m);
    });
    const fileKeyCountByTab = new Map();
    globParsedEntries.forEach((entry, i) => {
        if (!fileKeyCountByTab.has(entry.tabName)) fileKeyCountByTab.set(entry.tabName, new Map());
        const m = fileKeyCountByTab.get(entry.tabName);
        m.set(fileKeys[i], (m.get(fileKeys[i]) || 0) + 1);
    });
    const lastMatch = new Map(); // 탭 → { ord, fileOrd } 가장 최근에 짝지은 자리
    const WINDOW = 40;

    globParsedEntries.forEach((entry, i) => {
        // [v4.13] 탭은 여기서 빼지 않고 모두 불러둠 (보여줄 탭은 '탭 선택'에서 고름)
        let matchedLog = null;
        const candidates = scrapedByKey.get(fileKeys[i]);
        if (candidates) {
            if (scrapedByTab.has(entry.tabName)) {
                const range = tabRange.get(entry.tabName);
                const last = lastMatch.get(entry.tabName);
                const expected = last ? last.ord + (fileOrd[i] - last.fileOrd) : fileOrd[i] + (range ? range.head : 0);
                let best = null;
                candidates.forEach(log => {
                    if (log.used || log.tabName !== entry.tabName) return;
                    if (!best || Math.abs(log.ord - expected) < Math.abs(best.ord - expected)) best = log;
                });
                const isUniqueAnchor = fileKeys[i].length >= 6
                    && (keyCountByTab.get(entry.tabName).get(fileKeys[i]) === 1)
                    && (fileKeyCountByTab.get(entry.tabName).get(fileKeys[i]) === 1);
                if (best && (Math.abs(best.ord - expected) <= WINDOW || isUniqueAnchor)) {
                    matchedLog = best;
                    lastMatch.set(entry.tabName, { ord: best.ord, fileOrd: fileOrd[i] });
                }
            } else {
                // 백업기 데이터에 이 탭이 없으면(탭 이름을 못 맞춘 경우) 예전처럼 이름이 같은 대사부터
                matchedLog = candidates.find(log => !log.used && log.name === entry.name)
                    || candidates.find(log => !log.used);
            }
            if (matchedLog) matchedLog.used = true;
        }
        matches[i] = matchedLog;
    });

    // 2) [v4.18] 글자가 조금 다른 대사(수정한 대사 등)는 앞뒤 문맥으로 짝짓기
    //   같은 탭에서 앞뒤로 짝지어진 두 대사 사이의 빈칸을 보고, 같은 캐릭터 + 글자가 비슷한 대사끼리 순서대로 짝지음
    globContextMatchCount = 0;
    if (scrapedByTab.size) {
        scrapedByTab.forEach((list, tab) => {
            const range = tabRange.get(tab);
            if (!range) return;
            const idxs = [];
            globParsedEntries.forEach((entry, i) => { if (entry.tabName === tab) idxs.push(i); });
            let prevOrd = range.head - 1;
            let gap = [];
            const closeGap = (nextOrd) => {
                if (gap.length) {
                    const pool = list.slice(prevOrd + 1, Math.max(prevOrd + 1, nextOrd)).filter(item => !item.used);
                    if (pool.length && pool.length <= 60) {
                        globContextMatchCount += pairByContext(gap, pool, matches, fileKeys);
                    }
                }
                gap = [];
                prevOrd = nextOrd;
            };
            idxs.forEach(i => {
                const m = matches[i];
                if (m && m.tabName === tab) closeGap(m.ord);
                else if (!m) gap.push(i);
            });
            closeGap(Math.min(range.tailStart, list.length));
        });
    }

    // 3) 화면에 쓸 로그 만들기
    globParsedEntries.forEach((entry, i) => {
        const matchedLog = matches[i];
        const isSystem = entry.isSystem || SYSTEM_NAMES.includes(entry.name);
        const finalName = (matchedLog && matchedLog.name) || entry.name;

        tempLogs.push({
            id: `L${i}`, // [v4.13] 다시 불러와도 같은 번호 (바뀐 칸만 다시 그리기 위해)
            tabName: entry.tabName,
            name: finalName,
            // [v4.11] 백업기로 긁어온 이미지를 먼저 쓰고, 없을 때만 파일 안의 이미지를 씀
            imgUrl: (matchedLog && matchedLog.imgUrl) || entry.imgUrl || "",
            customImg: "",
            message: entry.message,
            color: (matchedLog && matchedLog.color) || entry.color || ((entry.name === "-" || isSystem) ? "#888888" : "#b4b4b4"),
            isNarration: isNarrationFor(finalName, entry.tabName, isSystem, narrationNames),
            isSystem,
            _noImg: !matchedLog && !entry.imgUrl
        });
    });

    // [v4.17] 짝을 못 찾아 인장이 빈 줄은, 같은 탭에서 같은 캐릭터의 가장 가까운 앞(없으면 뒤) 줄 인장을 빌려 씀
    //   (백업기를 쓴 경우에만. 표정이 다를 수 있으니, 필요하면 🖼 버튼으로 바꾸면 됨)
    globGuessedImgCount = 0;
    if (globScrapedLogs) {
        const fillFrom = (list) => {
            const last = new Map();
            list.forEach(log => {
                const key = `${log.tabName}\u0001${log.name}`;
                if (log.imgUrl) { if (!log._noImg || log.imgGuessed) last.set(key, log.imgUrl); return; }
                if (log._noImg && !log.isSystem && last.has(key)) {
                    log.imgUrl = last.get(key);
                    log.imgGuessed = true;
                    globGuessedImgCount++;
                }
            });
        };
        fillFrom(tempLogs);                    // 앞 줄에서
        fillFrom([...tempLogs].reverse());     // 앞에 없으면 뒤 줄에서
    }
    tempLogs.forEach(log => { delete log._noImg; });

    // [v4.15] 로그 파일이 1만 줄 제한 등으로 잘렸을 때, 잘린 대사를 백업기 데이터로 채움
    const finalLogs = globEntriesFromScrape ? tempLogs : fillCutLogs(tempLogs, scrapedByTab, tabRange, narrationNames);

    preloadImageSizes(finalLogs.map(log => getEffectiveImg(log)));
    LogStore.setLogs(finalLogs);
    populateNarrationDropdown();
    populateTabDropdown();
    updateOrderSelect();
    globAppliedNarrationKey = narrationKey();
    if (isImagePanelOpen()) renderImagePanel();
    return finalLogs.length;
}

// [v4.15] 파일에서 잘린 대사 채우기
//  - 각 탭에서 "파일이 시작하기 전" / "파일이 끝난 뒤"에 있는 백업기 대사만 채움 (탭 중간은 건드리지 않음)
//  - 잘린 구간은 탭끼리의 시간 순서를 알 수 없어서, 앞쪽은 맨 앞에·뒤쪽은 맨 끝에 탭별로 묶어서 넣음
function fillCutLogs(fileLogs, scrapedByTab, tabRange, narrationNames) {
    globFilledCount = 0;
    if (scrapedByTab.size === 0) return fileLogs;

    const before = [], after = [], noFileTabs = [];
    let beforeVotes = 0, afterVotes = 0;
    [...scrapedByTab.entries()]
        .sort((a, b) => (a[1][0].tabOrder || 0) - (b[1][0].tabOrder || 0))
        .forEach(([tab, list]) => {
            const range = tabRange.get(tab);
            if (!range) { noFileTabs.push(...list); return; }
            const head = list.slice(0, range.head);
            const tail = list.slice(range.tailStart);
            before.push(...head); after.push(...tail);
            beforeVotes += head.length; afterVotes += tail.length;
        });
    // 파일에 대사가 하나도 없는 탭은, 다른 탭들이 잘린 쪽(대부분 앞쪽)에 함께 넣음
    (afterVotes > beforeVotes ? after : before).push(...noFileTabs);

    if (before.length === 0 && after.length === 0) return fileLogs;

    const toLog = (item) => {
        const isSystem = !!item.isSystem || SYSTEM_NAMES.includes(item.name);
        return {
            id: `F${item.tabOrder || 0}-${item.index}`,
            tabName: item.tabName,
            name: item.name,
            imgUrl: item.imgUrl || "",
            customImg: "",
            message: textToHtml(item.message),
            color: item.color || ((item.name === "-" || isSystem) ? "#888888" : "#b4b4b4"),
            isNarration: isNarrationFor(item.name, item.tabName, isSystem, narrationNames),
            isSystem,
            filled: true
        };
    };
    globFilledCount = before.length + after.length;
    return [...before.map(toLog), ...fileLogs, ...after.map(toLog)];
}

// ==========================================
// [8] 화면 그리기
// ==========================================

function refreshContent(options) {
    if (LogStore.logs.length > 0) {
        renderPreview(LogStore.logs, options);
    } else if (globParsedEntries) {
        globBlockNodes = null;
        showStatus("⚠️ 표시할 로그가 없습니다. 코코포리아에서 내보낸 로그 파일(.html / .json / .zip)이 맞는지 확인해 주세요.");
    }
}

// 이미지가 하나도 없을 때 보여줄 안내 (다운로드 결과물에는 포함되지 않음)
function getNoticeHtml(logs) {
    if (globEntriesFromScrape) {
        return `<div class="notice-banner">ℹ️ 파일 없이 백업기 데이터만으로 보여주고 있어요. 탭끼리의 시간 순서를 알 수 없어서 <strong>탭별로 모아서</strong> 보여줘요. 여러 탭을 시간 순서대로 보려면 코코포리아 로그 파일([all] HTML·JSON·ZIP)을 올려 주세요.</div>`;
    }
    const lines = [];
    // [v4.15] 잘린 대사를 채웠으면 알려줌
    if (globFilledCount > 0) {
        lines.push(`ℹ️ 로그 파일에서 잘린 것으로 보이는 대사 <strong>${globFilledCount}개</strong>를 백업기 데이터로 채웠어요. `
            + `이 구간은 탭끼리의 시간 순서를 알 수 없어서 <strong>탭별로 묶어서</strong> 들어가 있어요.`);
    }
    // [v4.18] 문맥으로 짝지은 줄
    if (globContextMatchCount > 0) {
        lines.push(`ℹ️ 글자가 조금 달랐던 <strong>${globContextMatchCount}줄</strong>은 앞뒤 대사를 보고 백업기 데이터와 짝지었어요.`);
    }
    // [v4.17] 인장을 빌려 쓴 줄이 있으면 알려줌
    if (globGuessedImgCount > 0) {
        lines.push(`ℹ️ 백업기 데이터에서 짝을 못 찾은 <strong>${globGuessedImgCount}줄</strong>은 같은 캐릭터의 바로 앞(또는 뒤) 대사 인장을 썼어요. 표정이 다르면 이미지 위 🖼 버튼으로 바꿀 수 있어요.`);
    }
    const hasAnyImage = logs.some(log => !log.isNarration && !log.isSystem && getEffectiveImg(log));
    if (!hasAnyImage) {
        lines.push(`ℹ️ 이 파일에는 캐릭터 이미지가 들어 있지 않아요. 코코포리아에서 <strong>JSON</strong>이나 <strong>ZIP</strong> 형식으로 내보낸 파일을 쓰거나, 데이터 수집을 먼저 하거나, 🖼 이미지 설정에서 직접 넣을 수 있어요.`);
    }
    return lines.length ? `<div class="notice-banner">${lines.join('<br>')}</div>` : '';
}

// 로그를 화면의 칸(나레이션 한 줄 / 같은 캐릭터의 연속 대사 묶음) 단위로 나눔
function buildBlocks(logs) {
    const blocks = [];
    let current = null;
    logs.forEach(log => {
        // [v4.18] '따로' 탭 덩어리의 머리 (미리보기에서만 보이고 결과물에는 안 들어감)
        if (log.isGroupHead) {
            current = null;
            blocks.push({ type: 'ghead', tabName: log.tabName, count: log.count, anchored: log.anchored, canMove: log.canMove });
            return;
        }
        const tagHtml = (log.tabName === '메인') ? '' : `<span class="tab-tag">${log.tabName}</span>`;
        if (log.isSystem || log.isNarration || log.name === "-") {
            current = null;
            blocks.push({ type: 'narr', log, tagHtml });
            return;
        }
        const imgUrl = getEffectiveImg(log);
        if (current && current.imgUrl === imgUrl && current.tabName === log.tabName && current.name === log.name) {
            current.messages.push({ id: log.id, message: log.message });
        } else {
            current = {
                type: 'chat', imgUrl, tabName: log.tabName, name: log.name, color: log.color, tagHtml,
                messages: [{ id: log.id, message: log.message }]
            };
            blocks.push(current);
        }
    });
    return blocks;
}

// 칸의 "지문" — 내용이 같으면 같은 글자가 나와서, 이미 그려진 칸을 그대로 다시 쓸 수 있음
function blockSignature(block) {
    if (block.type === 'ghead') {
        return `g\u0001${block.tabName}\u0001${block.count}\u0001${block.anchored}\u0001${block.canMove}`;
    }
    if (block.type === 'narr') {
        return `n\u0001${block.log.id}\u0001${block.log.tabName}\u0001${block.log.message}\u0001${globMoves.has(block.log.id) ? 1 : 0}`;
    }
    return `c\u0001${block.name}\u0001${displayImgUrl(block.imgUrl)}\u0001${block.tabName}\u0001${getNameColor(block.name, block.color)}\u0001`
        + block.messages.map(m => `${m.id}\u0002${m.message}\u0002${globMoves.has(m.id) ? 1 : 0}`).join('\u0001');
}

// 칸 하나의 HTML
function blockHtml(block) {
    if (block.type === 'ghead') {
        const tab = escapeHtml(block.tabName);
        return `<div class="group-head" data-group-tab="${tab}">
                <span>📦 <strong>${tab}</strong> 탭 · ${block.count}줄 묶음</span>
                ${block.canMove ? `<button type="button" class="group-move-btn">위치 옮기기</button>` : ''}
                ${block.anchored ? `<button type="button" class="group-reset-btn">맨 뒤로</button>` : ''}
            </div>`;
    }
    if (block.type === 'narr') {
        const log = block.log;
        return `<div class="chat-row">
                ${block.tagHtml}
                <div class="bubble-wrapper${globMoves.has(log.id) ? ' moved' : ''}" data-log-id="${log.id}" style="width:100%;">
                    <div class="narration-box">${log.message}</div>
                    <div class="bubble-actions" style="position:absolute; right:10px; top:5px;">
                        <button class="action-mini-btn select-btn" title="여러 개 골라서 한 번에 옮기거나 지우기">선택</button><button class="action-mini-btn add-btn" title="이 대사 앞이나 뒤에 새 대사·나레이션 넣기">추가</button><button class="action-mini-btn move-btn" title="이 대사를 다른 곳으로 옮기기">이동</button>${globMoves.has(log.id) ? `<button class="action-mini-btn unmove-btn" title="원래 자리로 되돌리기">원래 자리</button>` : ''}
                        <button class="action-mini-btn edit-btn">수정</button>
                        <button class="action-mini-btn delete-btn">삭제</button>
                    </div>
                </div>
            </div>`;
    }

    const bubblesHtml = block.messages.map((msgObj) => {
        const isDice = msgObj.message.includes('＞');
        const bubbleClass = isDice ? 'message-bubble dice-bubble' : 'message-bubble';
        return `<div class="bubble-wrapper${globMoves.has(msgObj.id) ? ' moved' : ''}" data-log-id="${msgObj.id}">
                <p class="${bubbleClass}">${msgObj.message}</p>
                <div class="bubble-actions">
                    <button class="action-mini-btn select-btn" title="여러 개 골라서 한 번에 옮기거나 지우기">선택</button><button class="action-mini-btn add-btn" title="이 대사 앞이나 뒤에 새 대사·나레이션 넣기">추가</button><button class="action-mini-btn move-btn" title="이 대사를 다른 곳으로 옮기기">이동</button>${globMoves.has(msgObj.id) ? `<button class="action-mini-btn unmove-btn" title="원래 자리로 되돌리기">원래 자리</button>` : ''}
                    <button class="action-mini-btn edit-btn">수정</button>
                    <button class="action-mini-btn delete-btn">삭제</button>
                </div>
            </div>`;
    }).join('');

    const ids = block.messages.map(m => m.id).join(',');
    const shownImg = displayImgUrl(block.imgUrl);
    return `<div class="chat-row">
            ${block.tagHtml}
            <div class="avatar-box" data-char-idx="${charIdx(block.name)}" data-log-ids="${ids}">${shownImg ? `<img src="${escapeHtml(shownImg)}" alt="">` : ''}<button type="button" class="avatar-change-btn" title="이 이미지 바꾸기">🖼</button><button type="button" class="avatar-move-btn" title="이 칸(말풍선 묶음)을 통째로 옮기기">↕</button></div>
            <div class="text-wrap">
                <span class="char-name ${nameClass(getNameColor(block.name, block.color))}" style="color:${getNameColor(block.name, block.color)}">${block.name}</span>
                <div class="bubbles-container">${bubblesHtml}</div>
            </div>
        </div>`;
}

// [v4.19] 옮긴 대사들을 정해 둔 자리로 옮김 (옮긴 순서대로. 갈 자리의 대사가 안 보이면 원래 자리에 둠)
function applyMoves(list) {
    if (globMoves.size === 0) return list;
    const result = list.slice();
    globMoves.forEach((targetId, id) => {
        const from = result.findIndex(item => item.id === id);
        if (from < 0) return;
        const [item] = result.splice(from, 1);
        const to = result.findIndex(other => other.id === targetId);
        if (to < 0) { result.splice(from, 0, item); return; }
        result.splice(to, 0, item);
    });
    return result;
}

// [v4.21] 화면을 다시 그려도 보고 있던 자리가 그대로 있도록: 화면 위쪽에 보이던 대사들을 기억해 뒀다가 다시 맞춤
function captureScrollAnchor() {
    const toolbar = document.querySelector('.toolbar');
    const topLimit = toolbar && getComputedStyle(toolbar).position === 'sticky' ? toolbar.getBoundingClientRect().bottom : 0;
    const els = Array.from(document.querySelectorAll('#output-wrapper .log-container [data-log-id]'));
    const first = els.findIndex(el => el.getBoundingClientRect().bottom > topLimit);
    if (first < 0) return null;
    // 지워질 수도 있으니 몇 개를 같이 기억 (뒤쪽 것부터 차례로 찾아봄)
    return els.slice(first, first + 30).map(el => ({ id: el.getAttribute('data-log-id'), top: el.getBoundingClientRect().top }));
}
function restoreScrollAnchor(anchor) {
    if (!anchor) return;
    for (const a of anchor) {
        const el = document.querySelector(`#output-wrapper .log-container [data-log-id="${a.id}"]`);
        if (el) {
            window.scrollBy(0, el.getBoundingClientRect().top - a.top);
            return;
        }
    }
}

// options.incremental 이 true면: 바뀐 칸만 새로 만들고, 그대로인 칸(이미지 포함)은 다시 쓰기
function renderPreview(allLogs, options = {}) {
    const anchor = captureScrollAnchor();
    const colorCount = globNameColors.size;
    renderPreviewInner(allLogs, options);
    if (globNameColors.size !== colorCount || !options.incremental) refreshPreviewStyle();
    restoreScrollAnchor(anchor);
}

function renderPreviewInner(allLogs, options = {}) {
    const wrapper = document.getElementById('output-wrapper');
    let logs = allLogs.filter(log => isTabShown(log.tabName)); // [v4.13] 고른 탭만
    // [v4.16] 순서: '시간순' 탭들은 서로 섞어서 시간 순서대로 먼저, '따로' 탭들은 그 뒤에 탭 순서대로 모아서
    //   (모든 탭이 '따로'면 탭별로 모아 보기, 모두 '시간순'이면 시간 순서와 같음)
    const order = getTabList();
    const timeline = logs.filter(log => !isTabGrouped(log.tabName));
    // [v4.18] '따로' 탭은 탭마다 한 덩어리로 묶고, 정해 둔 대사 바로 앞에 넣음 (정해 둔 곳이 없으면 맨 뒤)
    const groups = new Map();
    logs.forEach(log => {
        if (!isTabGrouped(log.tabName)) return;
        if (!groups.has(log.tabName)) groups.set(log.tabName, []);
        groups.get(log.tabName).push(log);
    });
    const canMove = timeline.length > 0;
    const timelineIds = new Set(timeline.map(log => log.id));
    const before = new Map(); // 대사 id → 그 앞에 넣을 탭들
    const atEnd = [];
    order.filter(tab => groups.has(tab)).forEach(tab => {
        const anchor = globGroupAnchor.get(tab);
        if (anchor && timelineIds.has(anchor)) {
            if (!before.has(anchor)) before.set(anchor, []);
            before.get(anchor).push(tab);
        } else {
            atEnd.push(tab);
        }
    });
    const groupHead = (tab) => ({ isGroupHead: true, tabName: tab, count: groups.get(tab).length, anchored: !!(globGroupAnchor.get(tab) && timelineIds.has(globGroupAnchor.get(tab))), canMove });
    const ordered = [];
    timeline.forEach(log => {
        (before.get(log.id) || []).forEach(tab => ordered.push(groupHead(tab), ...groups.get(tab)));
        ordered.push(log);
    });
    atEnd.forEach(tab => ordered.push(groupHead(tab), ...groups.get(tab)));
    logs = applyMoves(ordered);
    if (logs.length === 0) {
        globBlockNodes = null;
        showStatus("선택한 탭에 대사가 없어요. 상단의 <strong>5. 탭 선택</strong>에서 탭을 골라 주세요.");
        return;
    }
    const blocks = buildBlocks(logs);
    const signatures = blocks.map(blockSignature);
    const container = wrapper.querySelector('.log-container');

    if (options.incremental && container && globBlockNodes) {
        const pool = new Map();
        globBlockNodes.forEach(({ sig, el }) => {
            if (!pool.has(sig)) pool.set(sig, []);
            pool.get(sig).push(el);
        });

        const fragment = document.createDocumentFragment();
        const created = [];
        const nextNodes = blocks.map((block, i) => {
            const sig = signatures[i];
            let el = pool.has(sig) ? pool.get(sig).shift() : null;
            if (!el) {
                const tpl = document.createElement('template');
                tpl.innerHTML = blockHtml(block).trim();
                el = tpl.content.firstElementChild;
                created.push(el);
            }
            fragment.appendChild(el);
            return { sig, el };
        });
        container.replaceChildren(fragment);
        created.forEach(el => styleAvatarsIn(el));
        globBlockNodes = nextNodes;
        syncSelection();

        // 안내 문구가 필요해졌거나 필요 없어졌으면 맞춰 줌
        const oldNotice = wrapper.querySelector('.notice-banner');
        const noticeHtml = getNoticeHtml(logs);
        if (oldNotice && !noticeHtml) oldNotice.remove();
        if (!oldNotice && noticeHtml) container.insertAdjacentHTML('beforebegin', noticeHtml);
        return;
    }

    const currentTheme = document.getElementById('theme-select').value || 'dark';
    wrapper.innerHTML = `${getLogStyles(currentTheme)}${getNoticeHtml(logs)}<div class="log-container">${blocks.map(blockHtml).join('')}</div>`;
    const newContainer = wrapper.querySelector('.log-container');
    globBlockNodes = Array.from(newContainer.children).map((el, i) => ({ sig: signatures[i], el }));
    styleAvatarsIn(wrapper);
    syncSelection();
    document.getElementById('copy-btn').disabled = false;
    document.getElementById('download-btn').disabled = false;
}

// [v4.22] 지금 테마에서는 색을 바꿨지만 다른 테마에서는 원래 색이 잘 보이는 이름은, 바꿨을 때 원래 색으로 되돌림
function restoreOriginalNameCss(current, other, prefix) {
    let css = '';
    globNameColors.forEach((i, color) => {
        if (readableNameColor(color, current) !== color && readableNameColor(color, other) === color) {
            css += `${prefix}.nc-${i} { color: ${color} !important; }\n`;
        }
    });
    return css;
}

// [v4.21] 결과물 위쪽에 '다크 / 라이트 모드' 전환 버튼을 넣음
//   블로그는 스크립트를 지우는 경우가 많아서, 스크립트 없이 체크 상자 + CSS만으로 바꿈
let globLastToggleId = '';
function wrapWithThemeToggle(containerHtml) {
    const current = document.getElementById('theme-select').value === 'light' ? 'light' : 'dark';
    const other = current === 'light' ? 'dark' : 'light';
    const c = THEME_STYLES[current], o = THEME_STYLES[other];
    const id = 'sori-theme-' + Math.random().toString(36).slice(2, 8);
    globLastToggleId = id;
    const on = `#${id}:checked ~ .log-container`;
    const label = (theme) => theme === 'light' ? '☀️ 라이트 모드' : '🌙 다크 모드';
    const css = `<style>
.sori-log { max-width: 800px; margin: 20px auto; }
.sori-log > .log-container { margin-top: 8px !important; }
.sori-theme-toggle { position: absolute !important; opacity: 0 !important; width: 1px !important; height: 1px !important; pointer-events: none; }
.sori-theme-btn { position: relative; display: block; width: 38px; height: 20px; margin: 0 6px 0 auto; padding: 0; box-sizing: border-box;
  border-radius: 10px; cursor: pointer; user-select: none; transition: background-color .2s;
  background-color: ${c.diceBg} !important; border: 1px solid ${c.narrationBg}; }
.sori-theme-btn::after { content: ""; position: absolute; top: 2px; left: ${current === 'dark' ? 2 : 20}px; width: 14px; height: 14px; border-radius: 50%;
  background-color: ${c.textMain}; transition: left .2s, background-color .2s; }
#${id}:checked + .sori-theme-btn { background-color: ${o.diceBg} !important; border-color: ${o.narrationBg}; }
#${id}:checked + .sori-theme-btn::after { left: ${current === 'dark' ? 20 : 2}px; background-color: ${o.textMain}; }
${on} { background-color: ${o.containerBg} !important; color: ${o.textMain} !important; }
${on} .avatar-box { background-color: ${o.bubbleBg} !important; }
${on} p.message-bubble { background-color: ${o.bubbleBg} !important; color: ${o.textBubble} !important; }
${on} p.message-bubble.dice-bubble { background-color: ${o.diceBg} !important; color: ${o.textDice} !important; }
${on} .narration-box { background-color: ${o.narrationBg} !important; color: ${o.textNarration} !important; }
${nameColorCss(other, on + ' ')}
${restoreOriginalNameCss(current, other, on + ' ')}
</style>`;
    return `${css}<div class="sori-log"><input type="checkbox" id="${id}" class="sori-theme-toggle" aria-label="다크/라이트 모드 바꾸기"><label for="${id}" class="sori-theme-btn" title="다크 / 라이트 모드"></label>${containerHtml}</div>`;
}

function buildFinalHtmlSource() {
    const logContainer = document.querySelector('#output-wrapper .log-container');
    if (!logContainer) return "";
    styleAvatarsIn(logContainer); // [v4.7] 복사·다운로드 직전에 이미지 확대 위치를 최신 값으로 다시 계산
    const cloneContainer = logContainer.cloneNode(true);
    // 편집용 버튼은 결과물에서 제거
    cloneContainer.querySelectorAll('.bubble-actions, .avatar-change-btn, .avatar-move-btn, .group-head').forEach(el => el.remove());
    cloneContainer.querySelectorAll('.moved, .selected').forEach(el => el.classList.remove('moved', 'selected'));
    cloneContainer.querySelectorAll('[data-log-ids]').forEach(el => el.removeAttribute('data-log-ids'));

    // [v4.4] 파일 안에 들어 있던 이미지는 결과물에 한 번씩만 넣어서 용량을 줄임
    const classByImg = new Map();
    let imgCss = '';
    cloneContainer.querySelectorAll('.avatar-box img').forEach(img => {
        const src = img.getAttribute('src') || '';
        const realSrc = globBlobToData.get(src) || src;
        if (!realSrc.startsWith('data:')) {
            if (realSrc !== src) img.setAttribute('src', realSrc);
            return; // 인터넷 주소 이미지는 그대로 <img>로 둠
        }
        let cls = classByImg.get(realSrc);
        if (!cls) {
            cls = `av-${classByImg.size}`;
            classByImg.set(realSrc, cls);
            imgCss += `.${cls}{background-image:url("${realSrc}");}\n`;
        }
        const span = document.createElement('span');
        span.className = `avatar-img ${cls}`;
        const style = img.getAttribute('style');
        if (style) span.setAttribute('style', style);
        img.replaceWith(span);
    });
    const imgStyleTag = classByImg.size
        ? `<style>.avatar-img{display:block;width:100%;height:100%;background-position:center;background-size:contain;background-repeat:no-repeat;}\n${imgCss}</style>`
        : '';

    return getLogStyles(document.getElementById('theme-select').value) + imgStyleTag + wrapWithThemeToggle(cloneContainer.outerHTML);
}

// ==========================================
// [9] 이벤트 리스너 및 초기화
// ==========================================

document.getElementById('theme-select').disabled = true;

window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'CCFOLIA_RAW_DATA') {
        // 받았다고 백업기에 알려줌 (알려주기에 실패해도 데이터 처리는 계속)
        try {
            event.source && event.source.postMessage({ type: 'CCFOLIA_DATA_RECEIVED' }, event.origin && event.origin !== 'null' ? event.origin : '*');
        } catch (e) { /* 무시 */ }
        const payload = event.data.payload || {};
        globScrapedLogs = payload.collectedLogs;
        globScrapedTabs = Array.isArray(payload.tabs) ? payload.tabs : [];
        // 예전 백업기(잡담 제외 선택)와도 맞게: 잡담을 빼고 긁었다면 잡담 탭을 꺼 둠
        // [v4.14] 백업기에서 잡담을 긁었으면 잡담 탭을 켜고, 뺐으면 꺼 둠
        if (payload.includeChatter === false) globTabChoice.set('잡담', false);
        if (payload.includeChatter === true) globTabChoice.set('잡담', true);

        if (globParsedEntries && !globEntriesFromScrape) {
            // 파일을 먼저 올렸다면, 수집 데이터로 다시 불러와 이미지를 채움
            buildLogsFromEntries();
        } else {
            // [v4.13] 파일이 없으면 백업기 데이터만으로 바로 보여줌
            globEntriesFromScrape = true;
            globParsedEntries = entriesFromScrape();
            buildLogsFromEntries();
            document.getElementById('theme-select').disabled = false;
            document.getElementById('image-panel-btn').disabled = false;
        }
    }
});

// [v4.4] 로그 파일 읽기 (HTML / JSON / ZIP 모두 가능)
document.getElementById('html-file-picker').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    globOriginFileName = file.name;

    showStatus("⏳ 파일을 읽는 중이에요...");
    await new Promise(resolve => setTimeout(resolve, 30)); // 안내 문구가 먼저 보이도록 잠깐 쉼

    try {
        let entries;
        if (/\.zip$/i.test(file.name)) entries = await parseZip(await file.arrayBuffer());
        else entries = parseLogText(await file.text());

        globParsedEntries = entries;
        globEntriesFromScrape = false;
        buildLogsFromEntries();
        document.getElementById('theme-select').disabled = false;
        document.getElementById('image-panel-btn').disabled = false;
    } catch (err) {
        globParsedEntries = null;
        if (err && err.message === 'NO_JSZIP') {
            showStatus("⚠️ 압축(ZIP) 파일을 열려면 인터넷 연결이 필요해요.<br>압축을 풀어서 안에 있는 HTML 파일을 올려 주셔도 돼요.");
        } else {
            showStatus("⚠️ 파일을 읽지 못했어요. 코코포리아에서 내보낸 로그 파일(.html / .json / .zip)인지 확인해 주세요.");
        }
    } finally {
    }
});

// 프리뷰 안의 버튼들 (수정 / 삭제 / 🖼 이미지 바꾸기)
// ==========================================
// [v4.20] 여러 개 고르기: 고른 대사를 한 번에 옮기거나 지움
// ==========================================
function displayedIds() {
    return Array.from(document.querySelectorAll('#output-wrapper .log-container [data-log-id]')).map(el => el.getAttribute('data-log-id'));
}
function syncSelection() {
    // 지워졌거나 안 보이는 대사는 선택에서 뺌
    const shown = new Set(displayedIds());
    [...globSelected].forEach(id => { if (!shown.has(id)) globSelected.delete(id); });
    document.querySelectorAll('#output-wrapper .bubble-wrapper').forEach(el => {
        el.classList.toggle('selected', globSelected.has(el.getAttribute('data-log-id')));
    });
    document.getElementById('output-wrapper').classList.toggle('select-mode', globSelected.size > 0);
    const bar = document.getElementById('select-bar');
    if (!bar) return;
    if (globSelected.size > 0) {
        document.getElementById('select-count').textContent = `${globSelected.size}개 선택됨`;
        bar.classList.add('show');
    } else {
        bar.classList.remove('show');
    }
}
function toggleSelect(id, withRange) {
    if (withRange && globLastSelected) {
        const order = displayedIds();
        const a = order.indexOf(globLastSelected), b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
            order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => globSelected.add(x));
            globLastSelected = id;
            syncSelection();
            return;
        }
    }
    if (globSelected.has(id)) globSelected.delete(id); else globSelected.add(id);
    globLastSelected = id;
    syncSelection();
}
function clearSelection() {
    globSelected.clear();
    globLastSelected = null;
    syncSelection();
}

// ==========================================
// [v4.20] 새 대사·나레이션 넣기
// ==========================================
let globAddRef = null; // 기준이 되는 대사 id

// 이 캐릭터의 인장·색: 기준 대사에서 가장 가까운 같은 캐릭터 대사의 것을 씀
function lookFor(name, refIndex) {
    const logs = LogStore.logs;
    for (let d = 0; d < logs.length; d++) {
        for (const k of [refIndex - d, refIndex + d]) {
            const log = logs[k];
            if (log && log.name === name && (log.customImg || log.imgUrl)) return { img: log.customImg || log.imgUrl, color: log.color };
        }
    }
    const any = logs.find(log => log.name === name);
    return { img: '', color: any ? any.color : '#b4b4b4' };
}

function openAddDialog(refId) {
    const ref = LogStore.logs.find(log => log.id === refId);
    if (!ref) return;
    globAddRef = refId;
    const select = document.getElementById('add-name');
    const names = getCharList();
    select.innerHTML = names.map(n => `<option value="${escapeHtml(n)}" ${n === ref.name ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')
        + `<option value="__custom">직접 입력…</option>`;
    document.getElementById('add-custom-name').value = '';
    document.getElementById('add-custom-name').style.display = 'none';
    document.getElementById('add-text').value = '';
    // 열 때마다 기본값으로: 대사 / 이 대사 아래 (나레이션 줄에서 열면 나레이션으로)
    document.querySelector(`input[name="add-kind"][value="${ref.name === '-' ? 'narr' : 'say'}"]`).checked = true;
    document.querySelector('input[name="add-where"][value="after"]').checked = true;
    document.getElementById('add-ref-text').textContent = `기준 대사: [${ref.tabName}] ${ref.name === '-' ? '나레이션' : ref.name} — ${ref.message.replace(/<[^>]+>/g, ' ').slice(0, 40)}`;
    updateAddKind();
    document.getElementById('add-dialog').classList.add('show');
    setTimeout(() => document.getElementById('add-text').focus(), 30);
}
function closeAddDialog() {
    document.getElementById('add-dialog').classList.remove('show');
    globAddRef = null;
}
function updateAddKind() {
    const kind = document.querySelector('input[name="add-kind"]:checked').value;
    document.getElementById('add-name-row').style.display = kind === 'say' ? '' : 'none';
}
function confirmAdd() {
    const text = document.getElementById('add-text').value.trim();
    if (!text) { document.getElementById('add-text').focus(); return; }
    const kind = document.querySelector('input[name="add-kind"]:checked').value;
    const where = document.querySelector('input[name="add-where"]:checked').value;
    let name = '-';
    if (kind === 'say') {
        name = document.getElementById('add-name').value;
        if (name === '__custom') name = document.getElementById('add-custom-name').value.trim();
        if (!name) { document.getElementById('add-custom-name').focus(); return; }
    }
    const logs = LogStore.logs.slice();
    const refIndex = logs.findIndex(log => log.id === globAddRef);
    if (refIndex < 0) { closeAddDialog(); return; }
    const ref = logs[refIndex];
    const look = kind === 'say' ? lookFor(name, refIndex) : { img: '', color: '#888888' };
    const newLog = {
        id: `N${++globAddCounter}`,
        tabName: ref.tabName,
        name,
        imgUrl: look.img,
        customImg: "",
        message: textToHtml(text),
        color: look.color,
        isNarration: kind === 'say' ? isNarrationFor(name, ref.tabName, false, getSelectedNarrations()) : false,
        isSystem: false,
        added: true
    };
    logs.splice(where === 'after' ? refIndex + 1 : refIndex, 0, newLog);
    // 기준 대사를 옮겨 둔 상태면, 새 대사도 그 옆으로 따라가게 함
    if (where === 'before') globMoves.set(newLog.id, ref.id);
    else if (globMoves.has(ref.id)) globMoves.set(newLog.id, globMoves.get(ref.id));
    closeAddDialog();
    LogStore.setLogs(logs, { incremental: true });
    if (kind === 'say' && !getCharList().includes(name)) populateNarrationDropdown();
}

// [v4.18][v4.19] 옮기기: '따로' 탭 묶음, 대사 한 줄, 칸(말풍선 묶음) 통째로
function startPlacing(what) {
    globPlacing = what;
    document.getElementById('output-wrapper').classList.add('placing');
    const toast = document.getElementById('place-toast');
    const label = what.kind === 'group'
        ? `📦 <strong>${escapeHtml(what.tab)}</strong> 탭 묶음을`
        : (what.ids.length > 1 ? `↕ 이 칸(대사 ${what.ids.length}줄)을` : `↕ 이 대사를`);
    toast.innerHTML = `${label} 넣을 곳의 대사를 누르면, 그 대사 <strong>바로 앞</strong>에 들어가요. (ESC: 취소)`;
    toast.classList.add('show');
    document.querySelectorAll('#output-wrapper .placing-source').forEach(el => el.classList.remove('placing-source'));
    if (what.kind === 'logs') {
        what.ids.forEach(id => document.querySelector(`#output-wrapper [data-log-id="${id}"]`)?.classList.add('placing-source'));
    }
}
function stopPlacing() {
    globPlacing = null;
    document.getElementById('output-wrapper').classList.remove('placing');
    document.getElementById('place-toast').classList.remove('show');
    document.querySelectorAll('#output-wrapper .placing-source').forEach(el => el.classList.remove('placing-source'));
}

document.getElementById('output-wrapper').addEventListener('click', (e) => {
    // 위치를 고르는 중이면: 누른 대사(말풍선) 바로 앞에 넣음
    if (globPlacing) {
        e.preventDefault();
        e.stopPropagation();
        const row = e.target.closest('.chat-row');
        const idEl = e.target.closest('[data-log-id]') || (row && row.querySelector('[data-log-id]'));
        const targetId = idEl && idEl.getAttribute('data-log-id');
        const log = targetId && LogStore.logs.find(l => l.id === targetId);
        const toast = document.getElementById('place-toast');
        if (!log) return;
        if (globPlacing.kind === 'group') {
            if (isTabGrouped(log.tabName)) {
                toast.innerHTML = `⚠️ '시간순' 탭의 대사를 눌러 주세요. 다른 '따로' 묶음 안에는 넣을 수 없어요. (ESC: 취소)`;
                return;
            }
            globGroupAnchor.set(globPlacing.tab, log.id);
        } else {
            if (globPlacing.ids.includes(targetId)) {
                toast.innerHTML = `⚠️ 옮길 대사 말고 다른 대사를 눌러 주세요. (ESC: 취소)`;
                return;
            }
            globPlacing.ids.forEach(id => { globMoves.delete(id); globMoves.set(id, targetId); });
            if (globPlacing.fromSelection) { globSelected.clear(); globLastSelected = null; }
        }
        stopPlacing();
        refreshContent({ incremental: true });
        return;
    }
    // [v4.20] 선택 / 추가 버튼
    const selectBtn = e.target.closest('.select-btn');
    if (selectBtn) {
        e.stopPropagation();
        toggleSelect(selectBtn.closest('.bubble-wrapper').getAttribute('data-log-id'), e.shiftKey);
        return;
    }
    const addBtn = e.target.closest('.add-btn');
    if (addBtn) {
        e.stopPropagation();
        openAddDialog(addBtn.closest('.bubble-wrapper').getAttribute('data-log-id'));
        return;
    }
    // [v4.20] 고르는 중이면, 말풍선을 누르기만 해도 골라짐 (Shift+클릭: 사이를 한꺼번에)
    if (globSelected.size > 0 && !e.target.closest('button')) {
        const bubble = e.target.closest('.bubble-wrapper');
        if (bubble) {
            toggleSelect(bubble.getAttribute('data-log-id'), e.shiftKey);
            return;
        }
    }
    // [v4.19] 대사 한 줄 옮기기 / 원래 자리로
    const lineMoveBtn = e.target.closest('.move-btn');
    if (lineMoveBtn) {
        e.stopPropagation();
        startPlacing({ kind: 'logs', ids: [lineMoveBtn.closest('.bubble-wrapper').getAttribute('data-log-id')] });
        return;
    }
    const unmoveBtn = e.target.closest('.unmove-btn');
    if (unmoveBtn) {
        globMoves.delete(unmoveBtn.closest('.bubble-wrapper').getAttribute('data-log-id'));
        refreshContent({ incremental: true });
        return;
    }
    // [v4.19] 칸(같은 캐릭터의 말풍선 묶음) 통째로 옮기기
    const boxMoveBtn = e.target.closest('.avatar-move-btn');
    if (boxMoveBtn) {
        e.stopPropagation();
        const ids = (boxMoveBtn.closest('.avatar-box').dataset.logIds || '').split(',').filter(Boolean);
        if (ids.length) startPlacing({ kind: 'logs', ids });
        return;
    }
    const moveBtn = e.target.closest('.group-move-btn');
    if (moveBtn) {
        e.stopPropagation();
        startPlacing({ kind: 'group', tab: moveBtn.closest('.group-head').dataset.groupTab });
        return;
    }
    const resetBtn = e.target.closest('.group-reset-btn');
    if (resetBtn) {
        globGroupAnchor.delete(resetBtn.closest('.group-head').dataset.groupTab);
        refreshContent({ incremental: true });
        return;
    }
    const avatarBtn = e.target.closest('.avatar-change-btn');
    if (avatarBtn) {
        e.stopPropagation();
        const ids = (avatarBtn.closest('.avatar-box').dataset.logIds || '').split(',').filter(Boolean);
        openAvatarMenu(avatarBtn, ids);
        return;
    }
    if (e.target.classList.contains('delete-btn')) {
        const logId = e.target.closest('.bubble-wrapper').getAttribute('data-log-id');
        LogStore.setLogs(LogStore.logs.filter(log => log.id !== logId), { incremental: true });
    }
    if (e.target.classList.contains('edit-btn')) {
        const logId = e.target.closest('.bubble-wrapper').getAttribute('data-log-id');
        const targetTextEl = e.target.closest('.bubble-wrapper').querySelector('.message-bubble, .narration-box');
        const newText = prompt("✏️ 수정할 내용을 입력하세요:", targetTextEl.innerText);
        if (newText !== null && newText.trim() !== "") {
            const updatedLogs = LogStore.logs.map(log =>
                log.id === logId ? { ...log, message: textToHtml(newText.trim()) } : log
            );
            LogStore.setLogs(updatedLogs);
        }
    }
});

// 🖼 메뉴 (이 묶음 이미지만 바꾸기)
document.getElementById('avatar-menu').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const target = globImageTarget;
    closeAvatarMenu();
    if (action === 'file') pickImageFileFor(target);
    else if (action === 'url') {
        const url = askImageUrl();
        if (url) applyImageToTarget(target, url);
    } else if (action === 'reset') applyImageToTarget(target, "");
});

// 이미지 파일을 고르면 대상에 적용
document.getElementById('image-file-picker').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !globImageTarget) return;
    try {
        const src = await readImageFile(file);
        applyImageToTarget(globImageTarget, src);
    } catch (err) {
        alert("이미지 파일을 읽지 못했습니다. PNG, JPG, WEBP, GIF 파일인지 확인해 주세요.");
    }
});

// [v4.7] 테마를 바꿀 때 로그 전체를 다시 그리지 않고, 색깔 설정(style)만 바꿔 끼움
// [v4.14] 순서 바꾸기 (그대로인 대사 칸은 다시 쓰고, 바뀐 곳만 새로 그림)
document.getElementById('order-select').addEventListener('change', (e) => {
    if (e.target.value === 'mixed') return; // '탭마다 다르게'는 탭 선택에서 고름
    const grouped = e.target.value === 'tab';
    getTabList().forEach(tab => globTabGrouped.set(tab, grouped)); // 모든 탭을 한꺼번에
    populateTabDropdown();
    refreshContent({ incremental: true });
});

// [v4.16] 탭 선택 안의 '시간순 / 따로' 버튼 (드롭다운을 닫을 때 한 번에 반영)
document.getElementById('tab-dropdown-menu').addEventListener('click', (e) => {
    const btn = e.target.closest('.order-toggle');
    if (!btn || btn.disabled) return;
    const tab = btn.dataset.tab;
    const grouped = !isTabGrouped(tab);
    globTabGrouped.set(tab, grouped);
    btn.classList.toggle('grouped', grouped);
    btn.textContent = grouped ? '따로' : '시간순';
});

// [v4.18] 탭 선택 안의 '나레이션 켬 / 끔' 버튼 (드롭다운을 닫을 때 한 번에 반영)
document.getElementById('tab-dropdown-menu').addEventListener('click', (e) => {
    const btn = e.target.closest('.narr-toggle');
    if (!btn) return;
    const tab = btn.dataset.tab;
    const on = !isNarrationTab(tab);
    globNarrationTabs.set(tab, on);
    btn.classList.toggle('on', on);
    btn.textContent = `나레이션 ${on ? '켬' : '끔'}`;
});

document.getElementById('theme-select').addEventListener('change', (e) => {
    if (e.target.value === 'light') document.body.classList.add('light-theme-view');
    else document.body.classList.remove('light-theme-view');

    const oldStyle = document.querySelector('#output-wrapper > style');
    if (oldStyle && document.querySelector('#output-wrapper .log-container')) {
        const tpl = document.createElement('template');
        tpl.innerHTML = getLogStyles(e.target.value).trim();
        oldStyle.replaceWith(tpl.content.firstElementChild);
    } else {
        refreshContent();
    }
});

// 나레이션 드롭다운 열기/닫기
document.getElementById('dropdown-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('narration-dropdown');
    if (dropdown.classList.contains('open')) closeNarrationDropdown(); // 다시 누르면 닫으면서 반영
    else dropdown.classList.add('open');
});

// [v4.13] 탭 선택 드롭다운
document.getElementById('tab-dropdown-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('tab-dropdown');
    if (dropdown.classList.contains('open')) closeTabDropdown();
    else dropdown.classList.add('open');
});
document.getElementById('tab-dropdown-menu').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    globTabChoice.set(e.target.value, e.target.checked);
    updateTabDropdownLabel();
});

// 바깥을 클릭하면 드롭다운 / 🖼 메뉴 닫기
document.addEventListener('click', (e) => {
    const tabDropdown = document.getElementById('tab-dropdown');
    if (tabDropdown && !tabDropdown.contains(e.target)) closeTabDropdown();
    const dropdown = document.getElementById('narration-dropdown');
    if (dropdown && !dropdown.contains(e.target)) closeNarrationDropdown(); // [v4.6] 바깥을 누르면 닫으면서 한 번에 반영
    const menu = document.getElementById('avatar-menu');
    if (menu && !menu.contains(e.target)) closeAvatarMenu();
});

// ESC 키로 열린 창 닫기
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeAvatarMenu();
    closeNarrationDropdown();
    closeTabDropdown();
    if (globPlacing) stopPlacing();
    else if (document.getElementById('add-dialog').classList.contains('show')) closeAddDialog();
    else if (globSelected.size > 0) clearSelection();
    document.getElementById('image-panel').classList.remove('open');
});

// [v4.6] 체크박스는 고르기만 하고, 화면 반영은 드롭다운을 닫을 때 한 번에
document.getElementById('dropdown-menu').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) globNarrationNames.add(e.target.value);
    else globNarrationNames.delete(e.target.value);
    updateDropdownLabel();
});

// 이미지 설정 패널 열기/닫기
document.getElementById('image-panel-btn').addEventListener('click', () => {
    const panel = document.getElementById('image-panel');
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
    } else {
        renderImagePanel();
        panel.classList.add('open');
    }
});
document.getElementById('image-panel-close').addEventListener('click', () => {
    document.getElementById('image-panel').classList.remove('open');
});

// 패널: 캐릭터별 확대 슬라이더
document.getElementById('image-panel-list').addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const card = e.target.closest('.char-card');
    const name = globCharNames[card.dataset.charIdx];
    const value = parseInt(e.target.value, 10);

    if (field === 'nameColor') {
        // [v4.24] 고르는 동안에는 화면의 이름 색만 바로 바꿔서 보여줌
        const picked = e.target.value;
        card.querySelector('.char-card-name').style.color = picked;
        document.querySelectorAll('#output-wrapper .chat-row').forEach(row => {
            const nameEl = row.querySelector('.char-name');
            if (nameEl && nameEl.textContent === name) { nameEl.style.color = picked; nameEl.className = 'char-name'; }
        });
        return;
    }
    if (field === 'zoom') {
        setCharSetting(name, { zoom: value / 100 });
        card.querySelector('[data-val="zoom"]').textContent = `${value}%`;
    }
    updateCharAvatars(name);
});

// [v4.24] 이름 색을 다 골랐으면 저장하고, 결과물에도 들어가도록 다시 그림
document.getElementById('image-panel-list').addEventListener('change', (e) => {
    if (e.target.dataset.field !== 'nameColor') return;
    const card = e.target.closest('.char-card');
    const name = globCharNames[card.dataset.charIdx];
    setCharSetting(name, { nameColor: e.target.value });
    saveCharSettingsNow();
    refreshContent({ incremental: true });
    renderImagePanel();
});

// 패널: 원래대로 / 파일로 변경 / URL로 변경
document.getElementById('image-panel-list').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const card = e.target.closest('.char-card');
    const name = globCharNames[card.dataset.charIdx];

    if (action === 'name-color-reset') {
        setCharSetting(name, { nameColor: '' });
        saveCharSettingsNow();
        refreshContent({ incremental: true });
        renderImagePanel();
        return;
    }
    if (action === 'reset') {
        delete globCharSettings[name];
        saveCharSettingsNow();
        refreshContent();
        renderImagePanel();
    } else if (action === 'file') {
        pickImageFileFor({ scope: 'char', name });
    } else if (action === 'url') {
        const url = askImageUrl();
        if (url) applyImageToTarget({ scope: 'char', name }, url);
    }
});

// 패널: 확대 위치 점 클릭·드래그
document.getElementById('image-panel-list').addEventListener('pointerdown', (e) => {
    const picker = e.target.closest('.focus-picker');
    if (!picker) return;
    e.preventDefault();
    picker.setPointerCapture?.(e.pointerId);
    picker.dataset.dragging = '1';
    setFocusFromPointer(picker, e);
});
document.getElementById('image-panel-list').addEventListener('pointermove', (e) => {
    const picker = e.target.closest('.focus-picker');
    if (picker && picker.dataset.dragging === '1') setFocusFromPointer(picker, e);
});
['pointerup', 'pointercancel'].forEach(type => {
    document.getElementById('image-panel-list').addEventListener(type, (e) => {
        const picker = e.target.closest('.focus-picker');
        if (picker) delete picker.dataset.dragging;
        saveCharSettingsNow();
    });
});

document.getElementById('download-btn').addEventListener('click', () => {
    const fullHtmlSource = buildFinalHtmlSource();
    if (!fullHtmlSource) return;
    let baseName = "cocofolia_processed_log";
    if (globOriginFileName) {
        const nameWithoutExt = globOriginFileName.replace(/\.[^/.]+$/, "");
        baseName = nameWithoutExt.replace(/\[[^\]]+\]$/, '').replace(/_?html_log$/i, '').trim();
    }

    // [v4.5] 다운로드 파일에만: 휴대폰에서 바로 열어도 휴대폰 화면 크기에 맞게 보이도록 설정 추가
    // (복사 버튼으로 블로그에 붙여넣는 코드는 그대로)
    const bodyBg = (THEME_STYLES[document.getElementById('theme-select').value] || THEME_STYLES.dark).bodyBg;
    const fileHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(baseName || "로그")}</title>
<style>body:has(#${globLastToggleId}:checked) { background-color: ${(THEME_STYLES[document.getElementById('theme-select').value === 'light' ? 'dark' : 'light']).bodyBg} !important; }</style>
</head>
<body style="margin:0; padding:0 12px; background-color:${bodyBg};">
${fullHtmlSource}
</body>
</html>`;

    const blob = new Blob([fileHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName || "cocofolia_processed_log"}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

document.getElementById('copy-btn').addEventListener('click', async () => {
    const fullHtmlSource = buildFinalHtmlSource();
    if (!fullHtmlSource) return;
    try {
        await navigator.clipboard.writeText(fullHtmlSource);
        alert("✨ HTML 전체 소스코드가 클립보드에 복사되었습니다!");
    } catch (err) { alert("클립보드 복사에 실패했습니다."); }
});

// ==========================================
// [v4.20] 선택 막대 (여러 개 옮기기 / 지우기)
// ==========================================
document.getElementById('select-move').addEventListener('click', () => {
    const order = displayedIds();
    const ids = order.filter(id => globSelected.has(id)); // 화면 순서대로
    if (ids.length) startPlacing({ kind: 'logs', ids, fromSelection: true });
});
document.getElementById('select-delete').addEventListener('click', () => {
    const count = globSelected.size;
    if (!count) return;
    if (!confirm(`고른 대사 ${count}개를 지울까요?`)) return;
    const removing = new Set(globSelected);
    clearSelection();
    LogStore.setLogs(LogStore.logs.filter(log => !removing.has(log.id)), { incremental: true });
});
document.getElementById('select-clear').addEventListener('click', clearSelection);

// [v4.20] 대사 추가 창
document.querySelectorAll('input[name="add-kind"]').forEach(r => r.addEventListener('change', updateAddKind));
document.getElementById('add-name').addEventListener('change', (e) => {
    const custom = document.getElementById('add-custom-name');
    custom.style.display = e.target.value === '__custom' ? '' : 'none';
    if (e.target.value === '__custom') custom.focus();
});
document.getElementById('add-ok').addEventListener('click', confirmAdd);
document.getElementById('add-cancel').addEventListener('click', closeAddDialog);
document.getElementById('add-dialog').addEventListener('click', (e) => { if (e.target.id === 'add-dialog') closeAddDialog(); });
document.getElementById('add-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirmAdd(); // Ctrl+Enter로 바로 추가
});
