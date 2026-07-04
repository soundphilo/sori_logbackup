// 💡 URL 파라미터에서 data(blobUrl) 주소를 낚아챕니다.
const urlParams = new URLSearchParams(window.location.search);
const dataBlobUrl = urlParams.get('data');

if (!dataBlobUrl) {
    document.getElementById('output-wrapper').innerHTML = `<h3 class="error-msg">❌ 전달된 데이터가 없습니다. 확장 프로그램을 통해 접근해주세요.</h3>`;
} else {
    // 임시 주소(Blob URL)에 접속해서 JSON 데이터를 가져옵니다.
    fetch(dataBlobUrl)
        .then(response => response.json())
        .then(finalOrderedLogs => {
            renderPreview(finalOrderedLogs);
            // 사용이 끝난 임시 주소는 메모리 해제
            URL.revokeObjectURL(dataBlobUrl); 
        })
        .catch(err => {
            document.getElementById('output-wrapper').innerHTML = `<h3 class="error-msg">❌ 데이터 로드 중 오류가 발생했습니다.</h3>`;
            console.error(err);
        });
}

// 빌더 및 아래 renderPreview 함수는 기존 코드와 100% 동일합니다.
function generatePureHtmlHtml(bodyContent) { ... }
function renderPreview(logs) { ... }
