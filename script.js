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
let globIncludeChatter = false;
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
const DEFAULT_CHAR_SETTING = { zoom: 1, fx: 0.5, fy: 0.5, img: "" };
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
    </style>`;
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
        const color = (LogStore.logs.find(log => log.name === name) || {}).color || '#ffffff';
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
            const isNarration = narrationNames.includes(log.name);
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

// 읽어 온 대사 목록 → 화면에 쓸 로그로 변환 (코코포리아 수집 데이터가 있으면 이미지를 짝지어 줌)
function buildLogsFromEntries() {
    if (!globParsedEntries) return 0;

    const scraperArray = globScrapedLogs ? JSON.parse(JSON.stringify(Object.values(globScrapedLogs))) : [];
    const narrationNames = getSelectedNarrations();
    const tempLogs = [];

    globParsedEntries.forEach(entry => {
        if (!globIncludeChatter && entry.tabName === '잡담') return;

        let matchedLog = null;
        if (scraperArray.length) {
            const key = getPureKey(entry.message);
            matchedLog = scraperArray.find(log => !log.used && log.tabName === entry.tabName && log.name === entry.name && getPureKey(log.matchKey) === key)
                || scraperArray.find(log => !log.used && log.name === entry.name && getPureKey(log.matchKey) === key)
                || scraperArray.find(log => !log.used && getPureKey(log.matchKey) === key);
            if (matchedLog) matchedLog.used = true;
        }

        const isSystem = entry.isSystem || SYSTEM_NAMES.includes(entry.name);
        const finalName = (matchedLog && matchedLog.name) || entry.name;

        tempLogs.push({
            id: Math.random().toString(36).substr(2, 9),
            tabName: entry.tabName,
            name: finalName,
            // [v4.11] 백업기로 긁어온 이미지를 먼저 쓰고, 없을 때만 파일 안의 이미지를 씀
            imgUrl: (matchedLog && matchedLog.imgUrl) || entry.imgUrl || "",
            customImg: "",
            message: entry.message,
            color: (matchedLog && matchedLog.color) || entry.color || ((entry.name === "-" || isSystem) ? "#888888" : "#b4b4b4"),
            isNarration: !isSystem && narrationNames.includes(finalName),
            isSystem
        });
    });

    preloadImageSizes(tempLogs.map(log => getEffectiveImg(log)));
    LogStore.setLogs(tempLogs);
    populateNarrationDropdown();
    globAppliedNarrationKey = narrationKey();
    if (isImagePanelOpen()) renderImagePanel();
    return tempLogs.length;
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
    const hasAnyImage = logs.some(log => !log.isNarration && !log.isSystem && getEffectiveImg(log));
    return hasAnyImage ? '' :
        `<div class="notice-banner">ℹ️ 이 파일에는 캐릭터 이미지가 들어 있지 않아요. 코코포리아에서 <strong>JSON</strong>이나 <strong>ZIP</strong> 형식으로 내보낸 파일을 쓰거나, 데이터 수집을 먼저 하거나, 🖼 이미지 설정에서 직접 넣을 수 있어요.</div>`;
}

// 로그를 화면의 칸(나레이션 한 줄 / 같은 캐릭터의 연속 대사 묶음) 단위로 나눔
function buildBlocks(logs) {
    const blocks = [];
    let current = null;
    logs.forEach(log => {
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
    if (block.type === 'narr') {
        return `n\u0001${block.log.id}\u0001${block.log.tabName}\u0001${block.log.message}`;
    }
    return `c\u0001${block.name}\u0001${displayImgUrl(block.imgUrl)}\u0001${block.tabName}\u0001${block.color}\u0001`
        + block.messages.map(m => `${m.id}\u0002${m.message}`).join('\u0001');
}

// 칸 하나의 HTML
function blockHtml(block) {
    if (block.type === 'narr') {
        const log = block.log;
        return `<div class="chat-row">
                ${block.tagHtml}
                <div class="bubble-wrapper" data-log-id="${log.id}" style="width:100%;">
                    <div class="narration-box">${log.message}</div>
                    <div class="bubble-actions" style="position:absolute; right:10px; top:5px;">
                        <button class="action-mini-btn edit-btn">수정</button>
                        <button class="action-mini-btn delete-btn">삭제</button>
                    </div>
                </div>
            </div>`;
    }

    const bubblesHtml = block.messages.map((msgObj) => {
        const isDice = msgObj.message.includes('＞');
        const bubbleClass = isDice ? 'message-bubble dice-bubble' : 'message-bubble';
        return `<div class="bubble-wrapper" data-log-id="${msgObj.id}">
                <p class="${bubbleClass}">${msgObj.message}</p>
                <div class="bubble-actions">
                    <button class="action-mini-btn edit-btn">수정</button>
                    <button class="action-mini-btn delete-btn">삭제</button>
                </div>
            </div>`;
    }).join('');

    const ids = block.messages.map(m => m.id).join(',');
    const shownImg = displayImgUrl(block.imgUrl);
    return `<div class="chat-row">
            ${block.tagHtml}
            <div class="avatar-box" data-char-idx="${charIdx(block.name)}" data-log-ids="${ids}">${shownImg ? `<img src="${escapeHtml(shownImg)}" alt="">` : ''}<button type="button" class="avatar-change-btn" title="이 이미지 바꾸기">🖼</button></div>
            <div class="text-wrap">
                <span class="char-name" style="color:${block.color}">${block.name}</span>
                <div class="bubbles-container">${bubblesHtml}</div>
            </div>
        </div>`;
}

// options.incremental 이 true면: 바뀐 칸만 새로 만들고, 그대로인 칸(이미지 포함)은 다시 쓰기
function renderPreview(logs, options = {}) {
    const wrapper = document.getElementById('output-wrapper');
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
    document.getElementById('copy-btn').disabled = false;
    document.getElementById('download-btn').disabled = false;
}

function buildFinalHtmlSource() {
    const logContainer = document.querySelector('#output-wrapper .log-container');
    if (!logContainer) return "";
    styleAvatarsIn(logContainer); // [v4.7] 복사·다운로드 직전에 이미지 확대 위치를 최신 값으로 다시 계산
    const cloneContainer = logContainer.cloneNode(true);
    // 편집용 버튼은 결과물에서 제거
    cloneContainer.querySelectorAll('.bubble-actions, .avatar-change-btn').forEach(el => el.remove());
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

    return getLogStyles(document.getElementById('theme-select').value) + imgStyleTag + cloneContainer.outerHTML;
}

// ==========================================
// [9] 이벤트 리스너 및 초기화
// ==========================================

document.getElementById('theme-select').disabled = true;

window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'CCFOLIA_RAW_DATA') {
        event.source.postMessage({ type: 'CCFOLIA_DATA_RECEIVED' }, event.origin);
        globScrapedLogs = event.data.payload.collectedLogs;
        globIncludeChatter = event.data.payload.includeChatter;

        if (globParsedEntries) {
            // 파일을 먼저 올렸다면, 수집 데이터로 다시 불러와 이미지를 채움
            buildLogsFromEntries();
        } else {
            showStatus("✅ 데이터 수집 완료! 상단에서 [로그 파일 업로드]를 진행해 주세요.");
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
document.getElementById('output-wrapper').addEventListener('click', (e) => {
    const avatarBtn = e.target.closest('.avatar-change-btn');
    if (avatarBtn) {
        e.stopPropagation();
        const ids = (avatarBtn.closest('.avatar-box').dataset.logIds || '').split(',').filter(Boolean);
        openAvatarMenu(avatarBtn, ids);
        return;
    }
    if (e.target.classList.contains('delete-btn')) {
        const logId = e.target.closest('.bubble-wrapper').getAttribute('data-log-id');
        LogStore.setLogs(LogStore.logs.filter(log => log.id !== logId));
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

// 바깥을 클릭하면 드롭다운 / 🖼 메뉴 닫기
document.addEventListener('click', (e) => {
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

    if (field === 'zoom') {
        setCharSetting(name, { zoom: value / 100 });
        card.querySelector('[data-val="zoom"]').textContent = `${value}%`;
    }
    updateCharAvatars(name);
});

// 패널: 원래대로 / 파일로 변경 / URL로 변경
document.getElementById('image-panel-list').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const card = e.target.closest('.char-card');
    const name = globCharNames[card.dataset.charIdx];

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
