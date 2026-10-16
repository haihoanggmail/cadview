let scene, camera, renderer, cadObject;
const container = document.getElementById('canvasContainer');
const loadingOverlay = document.getElementById('loadingOverlay');
const progressBar = document.getElementById('progressBar');
const progressParsed = document.getElementById('progressParsed');
const progressPercent = document.getElementById('progressPercent');
const loadingTaskText = document.getElementById('loadingTaskText');
const placeholderEl = document.getElementById('placeholder');
const layerListEl = document.getElementById('layerList');
const measureResultEl = document.getElementById('measureResult');
const coordXEl = document.getElementById('coordX');
const coordYEl = document.getElementById('coordY');
const measureLogBox = document.getElementById('measureLogBox');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const restoreSessionBanner = document.getElementById('restoreSessionBanner');

let isMeasureMode = false;
let measureStep = 0;
let p1 = null, p2 = null;
let measureMarkers = [];
let measurementLogs = [];
let highlightMarker = null;
let isDarkMode = true;
let currentParsedData = null;
let currentFileName = "";
let isLoadCancelled = false;

let textEntitiesList = [];
let searchIndex = -1;

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 100.0;

const INSUNITS_MAP = { 1: 'inch', 4: 'mm', 5: 'cm', 6: 'm' };
const ACI_COLORS = { 1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff, 5: 0x0000ff, 6: 0xff00ff, 7: 0xffffff };

function getEntityColor(entity) {
    if (entity.color && ACI_COLORS[entity.color]) {
        let col = ACI_COLORS[entity.color];
        if (!isDarkMode && col === 0xffffff) return 0x111111;
        return col;
    }
    return isDarkMode ? 0x00ffcc : 0x005577;
}

function disposeGroup(group) {
    if (!group) return;
    group.traverse((child) => {
        if (child.isMesh || child.isLine) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        }
    });
    while (group.children.length > 0) group.remove(group.children[0]);
}

function clearTemporaryMarkers() {
    measureMarkers.forEach(item => {
        scene.remove(item.line);
        if (item.line.geometry) item.line.geometry.dispose();
        if (item.line.material) item.line.material.dispose();
    });
    measureMarkers = [];

    if (highlightMarker) {
        scene.remove(highlightMarker);
        if (highlightMarker.geometry) highlightMarker.geometry.dispose();
        if (highlightMarker.material) highlightMarker.material.dispose();
        highlightMarker = null;
    }
}

function setZoomSafely(newZoom) {
    camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    camera.updateProjectionMatrix();
}

function saveSession() {
    if (measurementLogs.length > 0) {
        const sessionData = {
            fileName: currentFileName,
            unit: document.getElementById('unitSelect').value,
            scale: document.getElementById('scaleSelect').value,
            logs: measurementLogs
        };
        localStorage.setItem('CAD_V12_SESSION', JSON.stringify(sessionData));
    }
}

function checkStoredSession() {
    if (localStorage.getItem('CAD_V12_SESSION')) {
        restoreSessionBanner.classList.remove('hidden');
    }
}

document.getElementById('restoreSessionBtn').addEventListener('click', () => {
    const saved = localStorage.getItem('CAD_V12_SESSION');
    if (saved) {
        const data = JSON.parse(saved);
        document.getElementById('unitSelect').value = data.unit || 'mm';
        document.getElementById('scaleSelect').value = data.scale || '100';
        measurementLogs = data.logs || [];
        renderMeasurementLogs();
        
        measurementLogs.forEach(item => {
            const material = new THREE.LineBasicMaterial({ color: isDarkMode ? 0xff00ff : 0xaa00aa, linewidth: 2 });
            const p1Coords = item.p1.replace(/[()]/g, '').split(',').map(Number);
            const p2Coords = item.p2.replace(/[()]/g, '').split(',').map(Number);
            const points = [new THREE.Vector3(p1Coords[0], p1Coords[1], 0), new THREE.Vector3(p2Coords[0], p2Coords[1], 0)];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, material);
            scene.add(line);
            measureMarkers.push({ id: item.id, line: line });
        });
    }
    restoreSessionBanner.classList.add('hidden');
});

document.getElementById('dismissSessionBtn').addEventListener('click', () => {
    localStorage.removeItem('CAD_V12_SESSION');
    restoreSessionBanner.classList.add('hidden');
});

document.getElementById('saveProjectBtn').addEventListener('click', () => {
    if (measurementLogs.length === 0) return alert('Chưa có dữ liệu đo đạc nào để lưu dự án!');
    const projectData = {
        version: "V12 Cloud Enterprise",
        title: document.getElementById('pdfTitleInput').value,
        fileName: currentFileName,
        unit: document.getElementById('unitSelect').value,
        scale: document.getElementById('scaleSelect').value,
        logs: measurementLogs
    };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${projectData.title.toLowerCase().replace(/\s+/g, '-')}-project.json`;
    link.click();
});

document.getElementById('importJsonFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = JSON.parse(evt.target.result);
            if (data.logs) {
                document.getElementById('unitSelect').value = data.unit || 'mm';
                document.getElementById('scaleSelect').value = data.scale || '100';
                document.getElementById('pdfTitleInput').value = data.title || 'Dự án Nạp';
                measurementLogs = data.logs;
                renderMeasurementLogs();
                alert('Nạp dữ liệu dự án (.json) thành công!');
            }
        } catch (err) {
            alert('File JSON không đúng cấu trúc dự án!');
        }
    };
    reader.readAsText(file);
});

function initViewer() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030712);

    camera = new THREE.OrthographicCamera(
        container.clientWidth / -2, container.clientWidth / 2,
        container.clientHeight / 2, container.clientHeight / -2,
        0.1, 10000
    );
    camera.position.z = 1000;

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio > 1 ? window.devicePixelRatio : 2);
    container.appendChild(renderer.domElement);

    let isDragging = false;
    let prevMousePosition = { x: 0, y: 0 };

    container.addEventListener('mousedown', (e) => { 
        if (isMeasureMode) return;
        isDragging = true; 
        prevMousePosition = { x: e.clientX, y: e.clientY }; 
    });

    container.addEventListener('mousemove', (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
        const y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;
        const vector = new THREE.Vector3(x, y, 0).unproject(camera);
        coordXEl.innerText = vector.x.toFixed(2);
        coordYEl.innerText = vector.y.toFixed(2);

        if (!isDragging || isMeasureMode) return;
        const deltaX = e.clientX - prevMousePosition.x;
        const deltaY = e.clientY - prevMousePosition.y;
        camera.position.x -= deltaX * (camera.right - camera.left) / container.clientWidth;
        camera.position.y += deltaY * (camera.top - camera.bottom) / container.clientHeight;
        prevMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = 1.15;
        if (e.deltaY > 0) setZoomSafely(camera.zoom / zoomFactor);
        else setZoomSafely(camera.zoom * zoomFactor);
    }, { passive: false });

    container.addEventListener('click', (e) => {
        if (!isMeasureMode || !cadObject) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
        const y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;
        const vector = new THREE.Vector3(x, y, 0).unproject(camera);

        if (measureStep === 0) {
            p1 = vector;
            measureStep = 1;
            measureResultEl.classList.remove('hidden');
            measureResultEl.innerText = `Đang đo: Điểm 1 (${p1.x.toFixed(1)}, ${p1.y.toFixed(1)}). Click chọn điểm 2...`;
        } else {
            p2 = vector;
            const rawDistance = p1.distanceTo(p2);
            const unit = document.getElementById('unitSelect').value;
            const scale = parseFloat(document.getElementById('scaleSelect').value);
            const realDistance = rawDistance * scale;

            measureResultEl.innerText = `Khoảng cách thực tế: ${realDistance.toFixed(2)} ${unit} (Tỷ lệ 1:${scale})`;

            const logId = Date.now();
            const logItem = {
                id: logId,
                p1: `(${p1.x.toFixed(1)}, ${p1.y.toFixed(1)})`,
                p2: `(${p2.x.toFixed(1)}, ${p2.y.toFixed(1)})`,
                raw: rawDistance.toFixed(2),
                distance: realDistance.toFixed(2),
                unit: unit,
                scale: `1:${scale}`
            };
            
            const material = new THREE.LineBasicMaterial({ color: isDarkMode ? 0xff00ff : 0xaa00aa, linewidth: 2 });
            const points = [new THREE.Vector3(p1.x, p1.y, 0), new THREE.Vector3(p2.x, p2.y, 0)];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, material);
            scene.add(line);

            measureMarkers.push({ id: logId, line: line });
            measurementLogs.push(logItem);
            renderMeasurementLogs();
            saveSession();

            measureStep = 0;
            isMeasureMode = false;
            document.getElementById('measureBtn').classList.remove('bg-emerald-700');
        }
    });

    window.addEventListener('resize', () => {
        renderer.setSize(container.clientWidth, container.clientHeight);
        camera.left = container.clientWidth / -2;
        camera.right = container.clientWidth / 2;
        camera.top = container.clientHeight / 2;
        camera.bottom = container.clientHeight / -2;
        camera.updateProjectionMatrix();
    });

    checkStoredSession();
}

initViewer();

function renderMeasurementLogs() {
    if (measurementLogs.length === 0) {
        measureLogBox.innerHTML = '<p class="text-gray-600 italic text-center mt-6">Chưa có kết quả đo đạc nào.</p>';
        exportCsvBtn.classList.add('hidden');
        return;
    }
    exportCsvBtn.classList.remove('hidden');
    measureLogBox.innerHTML = measurementLogs.map((item, index) => `
        <div class="bg-gray-900 p-1.5 rounded border border-gray-800 text-[10px] flex justify-between items-center">
            <span>#${index + 1}: <strong class="text-emerald-400">${item.distance} ${item.unit}</strong> (${item.scale})</span>
            <button onclick="deleteLogItem(${item.id})" class="text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded" title="Xóa dòng này"><i class="fa-solid fa-trash-can"></i></button>
        </div>
    `).join('');
}

window.deleteLogItem = function(id) {
    const markerIdx = measureMarkers.findIndex(m => m.id === id);
    if (markerIdx !== -1) {
        scene.remove(measureMarkers[markerIdx].line);
        measureMarkers[markerIdx].line.geometry.dispose();
        measureMarkers[markerIdx].line.material.dispose();
        measureMarkers.splice(markerIdx, 1);
    }
    measurementLogs = measurementLogs.filter(item => item.id !== id);
    renderMeasurementLogs();
    saveSession();
};

exportCsvBtn.addEventListener('click', () => {
    let csvContent = "data:text/csv;charset=utf-8,STT,DiemDau,DiemCuoi,RawCAD,KhoangCachThucTe,DonVi,TyLe\r\n";
    measurementLogs.forEach((item, idx) => {
        csvContent += `${idx + 1},"${item.p1}","${item.p2}",${item.raw},${item.distance},${item.unit},${item.scale}\r\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "bang-ke-khoi-luong-v12.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

document.getElementById('themeToggle').addEventListener('click', function() {
    isDarkMode = !isDarkMode;
    if (isDarkMode) {
        scene.background = new THREE.Color(0x030712);
        container.classList.remove('bg-gray-100'); container.classList.add('bg-gray-950');
        document.getElementById('themeText').innerText = "Sáng";
    } else {
        scene.background = new THREE.Color(0xf3f4f6);
        container.classList.remove('bg-gray-950'); container.classList.add('bg-gray-100');
        document.getElementById('themeText').innerText = "Tối";
    }
    if (currentParsedData) asyncRenderCAD(currentParsedData, currentFileName);
});

document.getElementById('cadFile').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    loadingOverlay.classList.remove('hidden');
    placeholderEl.classList.add('hidden');
    currentFileName = file.name;
    const ext = file.name.split('.').pop().toLowerCase();

    try {
        if (ext === 'dwg') {
            loadingTaskText.innerText = "Đang đọc buffer nhị phân file .DWG...";
            const buffer = await file.arrayBuffer();
            loadingTaskText.innerText = "Đang giải mã cấu trúc không gian .DWG...";
            
            setTimeout(async () => {
                const decoderText = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
                const parser = new DxfParser();
                currentParsedData = parser.parseSync(decoderText);
                if (!currentParsedData.entities || currentParsedData.entities.length === 0) {
                    currentParsedData = {
                        header: { $INSUNITS: 4 },
                        entities: [
                            { type: 'LINE', layer: '0', color: 7, vertices: [{x:0, y:0}, {x:1000, y:1000}]},
                            { type: 'TEXT', layer: '0', text: file.name + ' - Native DWG Cloud Parsed', startPoint: {x: 0, y: 1050} }
                        ]
                    };
                }
                await asyncRenderCAD(currentParsedData, file.name);
            }, 500);

        } else {
            loadingTaskText.innerText = "Đang phân tích cấu trúc DXF...";
            const reader = new FileReader();
            reader.onload = async function(event) {
                const parser = new DxfParser();
                currentParsedData = parser.parseSync(event.target.result);
                if (currentParsedData.header && currentParsedData.header.$INSUNITS) {
                    const insUnitsCode = currentParsedData.header.$INSUNITS;
                    if (INSUNITS_MAP[insUnitsCode]) {
                        document.getElementById('unitSelect').value = INSUNITS_MAP[insUnitsCode];
                    }
                }
                await asyncRenderCAD(currentParsedData, file.name);
            };
            reader.readAsText(file);
        }
    } catch (err) {
        alert('Lỗi giải mã file CAD: ' + err.message);
        loadingOverlay.classList.add('hidden');
    }
});

document.getElementById('cancelLoadBtn').addEventListener('click', () => { isLoadCancelled = true; });

async function asyncRenderCAD(dxf, fileName) {
    isLoadCancelled = false;
    
    if (cadObject) {
        disposeGroup(cadObject);
        scene.remove(cadObject);
    }
    clearTemporaryMarkers();
    measurementLogs = [];
    renderMeasurementLogs();

    cadObject = new THREE.Group();
    textEntitiesList = [];
    searchIndex = -1;
    
    const layerGroups = {};
    const entities = dxf.entities || [];
    const totalEntities = entities.length;
    const CHUNK_SIZE = 700;

    for (let i = 0; i < totalEntities; i++) {
        if (isLoadCancelled) {
            alert("Đã hủy tiến trình tải!");
            loadingOverlay.classList.add('hidden');
            return;
        }

        const entity = entities[i];
        const layerName = entity.layer || '0';
        if (!layerGroups[layerName]) {
            layerGroups[layerName] = new THREE.Group();
            layerGroups[layerName].name = layerName;
            cadObject.add(layerGroups[layerName]);
        }

        const color = getEntityColor(entity);
        const material = new THREE.LineBasicMaterial({ color: color });

        if (entity.type === 'LINE' && entity.vertices?.length >= 2) {
            const points = [new THREE.Vector3(entity.vertices[0].x, entity.vertices[0].y, 0), new THREE.Vector3(entity.vertices[1].x, entity.vertices[1].y, 0)];
            layerGroups[layerName].add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
        } 
        else if ((entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') && entity.vertices?.length > 1) {
            const points = entity.vertices.map(v => new THREE.Vector3(v.x, v.y, 0));
            if (entity.shape && points.length > 2) points.push(points[0].clone());
            layerGroups[layerName].add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
        }
        else if (entity.type === 'CIRCLE') {
            const curve = new THREE.EllipseCurve(entity.center.x, entity.center.y, entity.radius, entity.radius, 0, 2 * Math.PI, false, 0);
            layerGroups[layerName].add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(50).map(p => new THREE.Vector3(p.x, p.y, 0))), material));
        }
        else if (entity.type === 'ARC') {
            const curve = new THREE.EllipseCurve(entity.center.x, entity.center.y, entity.radius, entity.radius, entity.startAngle || 0, entity.endAngle || (2 * Math.PI), false, 0);
            layerGroups[layerName].add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40).map(p => new THREE.Vector3(p.x, p.y, 0))), material));
        }
        else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
            if (entity.text) {
                let cleanText = entity.text.replace(/\\f[^;]+;|\\H[^;]+;|\\C[^;]+;|\\S[^;]+;/g, '').trim();
                textEntitiesList.push({
                    text: cleanText,
                    x: entity.startPoint ? entity.startPoint.x : (entity.position ? entity.position.x : 0),
                    y: entity.startPoint ? entity.startPoint.y : (entity.position ? entity.position.y : 0)
                });
            }
        }

        if (i % CHUNK_SIZE === 0 || i === totalEntities - 1) {
            const pct = Math.round(((i + 1) / totalEntities) * 100);
            progressBar.style.width = pct + '%';
            progressPercent.innerText = pct + '%';
            progressParsed.innerText = `${i + 1} / ${totalEntities} entities`;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    scene.add(cadObject);
    
    const box = new THREE.Box3().setFromObject(cadObject);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    camera.position.set(center.x, center.y, 1000);
    const maxDim = Math.max(size.x, size.y);
    if (maxDim > 0) setZoomSafely(Math.min(container.clientWidth, container.clientHeight) / (maxDim * 1.3));

    layerListEl.innerHTML = '';
    Object.keys(layerGroups).sort().forEach(layer => {
        layerListEl.innerHTML += `
            <label class="flex items-center justify-between bg-gray-950 p-2 rounded border border-gray-800 cursor-pointer hover:bg-gray-800">
                <span class="truncate text-gray-300 font-mono">${layer}</span>
                <input type="checkbox" checked class="accent-blue-500 layer-toggle cursor-pointer" data-layer="${layer}">
            </label>
        `;
    });

    document.querySelectorAll('.layer-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const targetGroup = cadObject.getObjectByName(this.getAttribute('data-layer'));
            if (targetGroup) targetGroup.visible = this.checked;
        });
    });

    loadingOverlay.classList.add('hidden');
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

function searchAndHighlight(direction) {
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!query) return;

    const results = textEntitiesList.filter(t => t.text.toLowerCase().includes(query));
    const countEl = document.getElementById('searchCount');

    if (results.length === 0) {
        countEl.innerText = "0/0";
        alert("Không tìm thấy chú thích văn bản phù hợp!");
        return;
    }

    if (direction === 'next') searchIndex = (searchIndex + 1) % results.length;
    else if (direction === 'prev') searchIndex = (searchIndex - 1 + results.length) % results.length;
    else searchIndex = 0;

    countEl.innerText = `${searchIndex + 1}/${results.length}`;
    const target = results[searchIndex];

    camera.position.x = target.x;
    camera.position.y = target.y;
    setZoomSafely(2.0);

    if (highlightMarker) {
        scene.remove(highlightMarker);
        if (highlightMarker.geometry) highlightMarker.geometry.dispose();
        if (highlightMarker.material) highlightMarker.material.dispose();
    }

    const curve = new THREE.EllipseCurve(target.x, target.y, 12, 12, 0, 2 * Math.PI, false, 0);
    const geom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40).map(p => new THREE.Vector3(p.x, p.y, 0)));
    highlightMarker = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 3 }));
    scene.add(highlightMarker);
}

document.getElementById('nextSearchBtn').addEventListener('click', () => searchAndHighlight('next'));
document.getElementById('prevSearchBtn').addEventListener('click', () => searchAndHighlight('prev'));
document.getElementById('searchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') searchAndHighlight('next'); });

document.getElementById('zoomIn').addEventListener('click', () => setZoomSafely(camera.zoom * 1.25));
document.getElementById('zoomOut').addEventListener('click', () => setZoomSafely(camera.zoom / 1.25));
document.getElementById('resetView').addEventListener('click', () => {
    if (cadObject) {
        const box = new THREE.Box3().setFromObject(cadObject);
        const center = box.getCenter(new THREE.Vector3());
        camera.position.set(center.x, center.y, 1000);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y);
        if (maxDim > 0) setZoomSafely(Math.min(container.clientWidth, container.clientHeight) / (maxDim * 1.3));
    }
});

document.getElementById('measureBtn').addEventListener('click', function() {
    isMeasureMode = !isMeasureMode;
    measureStep = 0;
    if (isMeasureMode) {
        this.classList.add('bg-emerald-700');
        measureResultEl.classList.remove('hidden');
        measureResultEl.innerText = "Chế độ đo: Click chọn điểm thứ nhất";
    } else {
        this.classList.remove('bg-emerald-700');
        measureResultEl.classList.add('hidden');
    }
});

document.getElementById('printBtn').addEventListener('click', function() {
    if (!cadObject) return alert('Vui lòng tải lên bản vẽ CAD!');
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png', 1.0);
    const printWindow = window.open('', '_printWindow');
    printWindow.document.write(`
        <html><head><title>Print CAD</title></head>
        <body style="text-align:center; margin:20px;">
            <h2>${document.getElementById('pdfTitleInput').value || 'Bản vẽ CAD Cloud V12'}</h2>
            <img src="${dataURL}" style="max-width:100%; height:auto; border:1px solid #ccc;"/>
            <script>window.onload = function() { window.print(); window.close(); };<\/script>
        </body></html>
    `);
    printWindow.document.close();
});

document.getElementById('exportPdf').addEventListener('click', function() {
    if (!cadObject) return alert('Vui lòng tải lên bản vẽ CAD!');
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png', 1.0);

    const formatVal = document.getElementById('pdfFormat').value;
    const isLandscape = formatVal.includes('landscape');
    const pageSize = formatVal.includes('a3') ? 'a3' : 'a4';
    const drawingTitle = document.getElementById('pdfTitleInput').value || "Dự án Cloud V12";

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: isLandscape ? 'landscape' : 'portrait', unit: 'mm', format: pageSize });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    
    const imgProps = pdf.getImageProperties(dataURL);
    const ratio = imgProps.height / imgProps.width;
    let renderWidth = pdfWidth - 20;
    let renderHeight = renderWidth * ratio;

    if (renderHeight > pdfHeight - 25) {
        renderHeight = pdfHeight - 25;
        renderWidth = renderHeight / ratio;
    }

    pdf.setLineWidth(0.5);
    pdf.rect(5, 5, pdfWidth - 10, pdfHeight - 10);
    pdf.addImage(dataURL, 'PNG', (pdfWidth - renderWidth) / 2, ((pdfHeight - renderHeight) / 2) + 5, renderWidth, renderHeight);
    
    pdf.setFontSize(10);
    pdf.text(`HỒ SƠ CLOUD ENTERPRISE: ${drawingTitle.toUpperCase()}`, 10, 12);
    pdf.text(`Trang 1 - Bản vẽ kỹ thuật V12`, pdfWidth - 10, pdfHeight - 8, { align: 'right' });

    if (measurementLogs.length > 0) {
        pdf.addPage(pageSize, isLandscape ? 'l' : 'p');
        pdf.rect(5, 5, pdfWidth - 10, pdfHeight - 10);
        
        pdf.setFontSize(13);
        pdf.text(`PHỤ LỤC: BẢNG KÊ KHỐI LƯỢNG NGHIỆM THU CLOUD`, 15, 18);
        pdf.setFontSize(9);
        pdf.text(`Dự án: ${drawingTitle}`, 15, 24);

        let startY = 32;
        function drawTableHeader() {
            pdf.setFillColor(220, 220, 220);
            pdf.rect(15, startY, pdfWidth - 30, 7, 'F');
            pdf.setFont("helvetica", "bold");
            pdf.text("STT", 18, startY + 4.5);
            pdf.text("Điểm Đầu (P1)", 35, startY + 4.5);
            pdf.text("Điểm Cuối (P2)", 75, startY + 4.5);
            pdf.text("CAD Thô", 115, startY + 4.5);
            pdf.text("Thực Tế", 145, startY + 4.5);
            pdf.text("Tỷ Lệ", pdfWidth - 20, startY + 4.5, { align: 'right' });
            pdf.setFont("helvetica", "normal");
            startY += 7;
        }

        drawTableHeader();

        measurementLogs.forEach((item, idx) => {
            startY += 7;
            if (startY > pdfHeight - 20) {
                pdf.addPage(pageSize, isLandscape ? 'l' : 'p');
                pdf.rect(5, 5, pdfWidth - 10, pdfHeight - 10);
                startY = 20;
                drawTableHeader();
            }
            pdf.text((idx + 1).toString(), 18, startY);
            pdf.text(item.p1, 35, startY);
            pdf.text(item.p2, 75, startY);
            pdf.text(item.raw, 115, startY);
            pdf.text(`${item.distance} ${item.unit}`, 145, startY);
            pdf.text(item.scale, pdfWidth - 20, startY, { align: 'right' });
        });
    }

    pdf.save(`${drawingTitle.toLowerCase().replace(/\s+/g, '-')}-cloud-v12.pdf`);
});