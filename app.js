// ===============================
// NUCLY v2 APPLICATION STATE
// ===============================
const app = {
    imageLoaded:false,
    mode:"pos",
    zoom:1,
    minZoom:0.1,
    maxZoom:5,
    markers:[],
    undoStack:[],
    redoStack:[],
    roi:null,
    roiDrawing:false,
    roiDrawingActive:false,
    roiStart:null,
    pan:{x:0,y:0},
    markerSize:8,
    markerStyle:"ring",
    aiMarkers:[],
    aiRunning:false,
    brushSize:25,
    erasing:false,
    erasedBatch:[],
    originalImageData:null,
    adjustmentsApplied:false
};

// ===============================
// CANVAS SETUP
// ===============================
const imageCanvas = document.getElementById("imageCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const imageCtx = imageCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");
const stage = document.getElementById("stage");
const viewer = document.getElementById("viewer");
const fileInput = document.getElementById("fileInput");
let sourceImage = new Image();

// ===============================
// VISION ENGINE READY CHECK
// OpenCV is loaded asynchronously so the console stays interactive (and
// manual counting stays usable) while the 11 MB WASM engine compiles.
// ===============================
let engineReady = false;

function setEngineStatus(text, fade){
    let el = document.getElementById("engineStatus");
    if(!el) return;
    el.style.display = "inline";
    el.innerHTML = text;
    el.style.opacity = "1";
    if(fade){
        el.style.opacity = "0.35";
        setTimeout(function(){ el.style.display = "none"; }, 1800);
    }
}

function onEngineReady(){
    if(engineReady) return;
    engineReady = true;
    setEngineStatus("Engine ready", true);
}

(function watchEngine(tries){
    tries = tries || 0;
    if(typeof cv === "undefined"){
        // 90 s of grace: a cold first load of the engine is slow on phones.
        if(tries > 900){
            setEngineStatus("Detection engine unavailable — manual counting still works", false);
            return;
        }
        setTimeout(function(){ watchEngine(tries + 1); }, 100);
        return;
    }
    if(cv.Mat){ onEngineReady(); return; }
    if(typeof cv.then === "function"){ cv.then(onEngineReady); return; }
    cv["onRuntimeInitialized"] = onEngineReady;
})(0);

// ===============================
// IMAGE LOADING
// ===============================
fileInput.onchange=function(e){
    let file=e.target.files[0];
    if(!file) return;
    let reader=new FileReader();
    reader.onload=function(ev){
        sourceImage.onload=function(){
            app.imageLoaded=true;
            setupCanvas();
            fitImage();
        };
        sourceImage.src=ev.target.result;
    };
    reader.readAsDataURL(file);
};

// ===============================
// CANVAS INITIALIZATION
// ===============================
function setupCanvas(){
    imageCanvas.width = sourceImage.naturalWidth;
    imageCanvas.height = sourceImage.naturalHeight;
    overlayCanvas.width = sourceImage.naturalWidth;
    overlayCanvas.height = sourceImage.naturalHeight;
    imageCtx.clearRect(0,0,imageCanvas.width,imageCanvas.height);
    imageCtx.drawImage(sourceImage,0,0);
    // Store original for adjustment resets
    app.originalImageData = imageCtx.getImageData(0,0,imageCanvas.width,imageCanvas.height);
    app.adjustmentsApplied = false;
    redraw();
}

// ===============================
// COORDINATE CONVERSION
// ===============================
function screenToImage(e){
    let rect = viewer.getBoundingClientRect();
    let x = (e.clientX - rect.left - app.pan.x) / app.zoom;
    let y = (e.clientY - rect.top - app.pan.y) / app.zoom;
    return {x:x, y:y};
}

// ===============================
// IMAGE FIT
// ===============================
function fitImage(){
    if(!app.imageLoaded) return;
    let ratio=Math.min(viewer.clientWidth/imageCanvas.width, viewer.clientHeight/imageCanvas.height);
    app.zoom=ratio;
    updateTransform();
}

// ===============================
// ZOOM
// ===============================
function zoomIn(){
    app.zoom*=1.2;
    limitZoom();
    updateTransform();
}
function zoomOut(){
    app.zoom/=1.2;
    limitZoom();
    updateTransform();
}
function limitZoom(){
    if(app.zoom<app.minZoom) app.zoom=app.minZoom;
    if(app.zoom>app.maxZoom) app.zoom=app.maxZoom;
}
function updateTransform(){
    stage.style.transform = `translate(${app.pan.x}px,${app.pan.y}px) scale(${app.zoom})`;
    document.getElementById("zoomSlider").value = app.zoom*100;
    document.getElementById("zoomText").innerHTML = Math.round(app.zoom*100)+"%";
}
document.getElementById("zoomSlider").oninput=function(){
    app.zoom=this.value/100;
    limitZoom();
    updateTransform();
};

// ===============================
// FULLSCREEN
// ===============================
function toggleFullscreen(){
    viewer.classList.toggle("fullscreen");
}

// ===============================
// MODES
// ===============================
function setMode(m){
    app.mode=m;
    let text="Positive";
    if(m==="weak") text="Weak / Blush";
    if(m==="neg") text="Negative";
    if(m==="erase") text="Erase (drag to brush-erase)";
    document.getElementById("currentMode").innerHTML=text;
    imageCanvas.style.cursor = m==="erase" ? "not-allowed" : "crosshair";
    viewer.style.cursor = m==="erase" ? "not-allowed" : "default";
    document.getElementById("eraseControls").style.display = m==="erase" ? "block" : "none";
}

// ===============================
// MARKER SYSTEM
// ===============================
function addMarker(x,y,type){
    let marker={
        id:Date.now()+Math.random(),
        x:x,
        y:y,
        type:type,
        source:"manual"
    };
    app.markers.push(marker);
    app.undoStack.push({action:"add", marker:marker});
    app.redoStack=[];
    redraw();
    updateCount();
}

function removeMarker(marker){
    app.markers = app.markers.filter(m=>m.id!==marker.id);
}

function eraseAtPoint(x,y){
    let threshold=app.brushSize;
    let removed=[];
    app.markers=app.markers.filter(m=>{
        let dx=m.x-x;
        let dy=m.y-y;
        if(Math.sqrt(dx*dx+dy*dy) < threshold){
            removed.push(m);
            return false;
        }
        return true;
    });
    if(removed.length>0){
        app.erasedBatch=app.erasedBatch.concat(removed);
        redraw();
        updateCount();
    }
}

function removeNearbyMarker(x,y){
    eraseAtPoint(x,y);
}

// ===============================
// DRAW OVERLAY
// ===============================
function redraw(){
    overlayCtx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);

    // Draw brush preview if erasing
    if(app.erasing && mouseDownPos){
        overlayCtx.beginPath();
        overlayCtx.arc(mouseDownPos.x,mouseDownPos.y,app.brushSize,0,Math.PI*2);
        overlayCtx.strokeStyle="rgba(255,0,0,0.5)";
        overlayCtx.lineWidth=2;
        overlayCtx.setLineDash([4,4]);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);
        overlayCtx.fillStyle="rgba(255,0,0,0.1)";
        overlayCtx.fill();
    }

    app.markers.forEach(function(m){
        let color = m.type==="pos" ? "red" : (m.type==="weak" ? "#ff8c00" : "blue");
        overlayCtx.strokeStyle=color;
        overlayCtx.fillStyle=color;
        overlayCtx.lineWidth=2;

        if(m.source==="AI"){
            // AI markers: filled dot with subtle glow so they pop
            overlayCtx.beginPath();
            overlayCtx.arc(m.x,m.y,app.markerSize,0,Math.PI*2);
            overlayCtx.globalAlpha=0.85;
            overlayCtx.fill();
            overlayCtx.globalAlpha=1.0;
            // small white center for contrast
            overlayCtx.beginPath();
            overlayCtx.fillStyle="white";
            overlayCtx.arc(m.x,m.y,app.markerSize*0.35,0,Math.PI*2);
            overlayCtx.fill();
            overlayCtx.fillStyle=color;
        } else {
            // Manual markers: hollow ring with crosshair center
            overlayCtx.beginPath();
            overlayCtx.arc(m.x,m.y,app.markerSize,0,Math.PI*2);
            overlayCtx.stroke();
            // crosshair center
            overlayCtx.beginPath();
            overlayCtx.moveTo(m.x-3,m.y); overlayCtx.lineTo(m.x+3,m.y);
            overlayCtx.moveTo(m.x,m.y-3); overlayCtx.lineTo(m.x,m.y+3);
            overlayCtx.stroke();
        }
    });
    // DRAW ROI
    if(app.roi && app.roi.points && app.roi.points.length>0){
        overlayCtx.strokeStyle="lime";
        overlayCtx.lineWidth=3;
        overlayCtx.setLineDash([8,5]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(app.roi.points[0].x,app.roi.points[0].y);
        for(let i=1;i<app.roi.points.length;i++){
            overlayCtx.lineTo(app.roi.points[i].x,app.roi.points[i].y);
        }
        if(!app.roiDrawingActive){
            overlayCtx.closePath();
        }
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);
        if(!app.roiDrawingActive){
            overlayCtx.fillStyle="rgba(0,255,0,0.08)";
            overlayCtx.fill();
        }
    }
}

// ===============================
// COUNTER
// ===============================
function updateCount(){
    let pos = app.markers.filter(m=>m.type==="pos").length;
    let weak = app.markers.filter(m=>m.type==="weak").length;
    let neg = app.markers.filter(m=>m.type==="neg").length;
    document.getElementById("positiveCount").innerHTML=pos;
    document.getElementById("weakCount").innerHTML=weak;
    document.getElementById("negativeCount").innerHTML=neg;
    let total=pos+weak+neg;
    let kiStrong = total ? ((pos/total)*100).toFixed(1) : 0;
    let kiAllPos = total ? (((pos+weak)/total)*100).toFixed(1) : 0;
    document.getElementById("ki67Value").innerHTML=kiStrong+"%";
    document.getElementById("ki67AllPos").innerHTML="All Pos: "+kiAllPos+"%";
}

// ===============================
// RESET
// ===============================
function resetImage(){
    app.markers=[];
    app.aiMarkers=[];
    app.undoStack=[];
    app.redoStack=[];
    app.roi=null;
    app.pan.x=0;
    app.pan.y=0;
    app.zoom=1;
    resetAdjustments();
    if(sourceImage.src){
        imageCtx.clearRect(0,0,imageCanvas.width,imageCanvas.height);
        imageCtx.drawImage(sourceImage,0,0);
        app.originalImageData = imageCtx.getImageData(0,0,imageCanvas.width,imageCanvas.height);
    }
    fitImage();
    redraw();
    updateCount();
}

function fullReset(){
    resetImage();
}

// ===============================
// UNDO / REDO
// ===============================
function undo(){
    if(app.undoStack.length===0) return;
    let action=app.undoStack.pop();
    if(action.action==="add"){
        app.markers=app.markers.filter(m=>m.id!==action.marker.id);
        app.redoStack.push({action:"add", marker:action.marker});
    } else if(action.action==="remove"){
        // support batch remove
        let marks = action.markers || [action.marker];
        marks.forEach(m=>app.markers.push(m));
        app.redoStack.push({action:"remove", markers:marks, marker:action.marker});
    }
    redraw();
    updateCount();
}

function redo(){
    if(app.redoStack.length===0) return;
    let action=app.redoStack.pop();
    if(action.action==="add"){
        app.markers.push(action.marker);
        app.undoStack.push({action:"add", marker:action.marker});
    } else if(action.action==="remove"){
        let marks = action.markers || [action.marker];
        app.markers=app.markers.filter(m=>{
            return !marks.some(rm=>rm.id===m.id);
        });
        app.undoStack.push({action:"remove", markers:marks, marker:action.marker});
    }
    redraw();
    updateCount();
}

// ===============================
// ROI FUNCTIONS
// ===============================
function startROI(){
    app.roiDrawing=true;
    viewer.style.cursor="crosshair";
    document.getElementById("currentMode").innerHTML="Draw ROI (pen trace — click & drag)";
}

function clearROI(){
    app.roi=null;
    app.roiDrawing=false;
    app.roiDrawingActive=false;
    viewer.style.cursor="default";
    redraw();
}

function analyzeROI(){
    if(!app.roi || !app.roi.points || app.roi.points.length<3){
        alert("Please draw an ROI first (trace a closed region).");
        return;
    }
    runAI();
}

function pointInPolygon(x,y,points){
    if(!points || points.length<3) return true;
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
        let xi=points[i].x,yi=points[i].y;
        let xj=points[j].x,yj=points[j].y;
        let intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi);
        if(intersect) inside=!inside;
    }
    return inside;
}

function isPointInROI(x,y){
    if(!app.roi) return true;
    return pointInPolygon(x,y,app.roi.points);
}

// ===============================
// MARKER SIZE CONTROL
// ===============================
function setMarkerSize(value){
    app.markerSize=Number(value);
    redraw();
}
function setBrushSize(value){
    app.brushSize=Number(value);
    document.getElementById("brushSizeVal").innerHTML=value;
    redraw();
}

// ===============================
// IMAGE ADJUSTMENTS (Photoshop-style)
// ===============================
function adjustImage(){
    if(!app.imageLoaded || !app.originalImageData) return;

    let brightness = Number(document.getElementById("brightSlider").value);
    let contrast = Number(document.getElementById("contrastSlider").value);
    let gamma = Number(document.getElementById("gammaSlider").value) / 100;
    let saturation = Number(document.getElementById("satSlider").value);
    let sharpen = Number(document.getElementById("sharpSlider").value);
    let whiten = Number(document.getElementById("whiteSlider").value);
    let temperature = Number(document.getElementById("tempSlider").value);

    document.getElementById("brightVal").innerHTML = brightness;
    document.getElementById("contrastVal").innerHTML = contrast;
    document.getElementById("gammaVal").innerHTML = gamma.toFixed(1);
    document.getElementById("satVal").innerHTML = saturation;
    document.getElementById("sharpVal").innerHTML = sharpen;
    document.getElementById("whiteVal").innerHTML = whiten;
    document.getElementById("tempVal").innerHTML = temperature;

    let src = app.originalImageData;
    let dst = imageCtx.createImageData(src.width, src.height);
    let data = src.data;
    let out = dst.data;

    // Contrast factor
    let cf = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for(let i=0; i<data.length; i+=4){
        let r = data[i];
        let g = data[i+1];
        let b = data[i+2];

        // Brightness
        r += brightness;
        g += brightness;
        b += brightness;

        // Contrast
        r = cf * (r - 128) + 128;
        g = cf * (g - 128) + 128;
        b = cf * (b - 128) + 128;

        // Gamma / Exposure
        r = 255 * Math.pow(Math.max(0, r)/255, gamma);
        g = 255 * Math.pow(Math.max(0, g)/255, gamma);
        b = 255 * Math.pow(Math.max(0, b)/255, gamma);

        // Saturation
        if(saturation !== 0){
            let gray = 0.2989*r + 0.5870*g + 0.1140*b;
            let s = 1 + saturation/100;
            r = gray + (r - gray) * s;
            g = gray + (g - gray) * s;
            b = gray + (b - gray) * s;
        }

        // Whiten background: boost light pixels more than dark ones
        if(whiten > 0){
            let avg = (r+g+b)/3;
            if(avg > 180){
                let boost = (avg - 180) / 75 * whiten;
                r += boost; g += boost; b += boost;
            }
        }

        // Temperature: warm adds red, cool adds blue
        if(temperature !== 0){
            r += temperature * 1.5;
            b -= temperature * 1.5;
        }

        out[i] = Math.min(255, Math.max(0, r));
        out[i+1] = Math.min(255, Math.max(0, g));
        out[i+2] = Math.min(255, Math.max(0, b));
        out[i+3] = data[i+3]; // alpha
    }

    // Sharpen using unsharp mask approximation
    if(sharpen > 0){
        out = applySharpen(out, src.width, src.height, sharpen/200);
    }

    imageCtx.putImageData(dst, 0, 0);
}

function applySharpen(data, w, h, amount){
    // Simple 3x3 sharpen kernel
    let output = new Uint8ClampedArray(data);
    for(let y=1; y<h-1; y++){
        for(let x=1; x<w-1; x++){
            let i = (y*w + x) * 4;
            for(let c=0; c<3; c++){
                let val = data[i+c] * (1 + 4*amount)
                        - data[i+c - 4] * amount
                        - data[i+c + 4] * amount
                        - data[i+c - w*4] * amount
                        - data[i+c + w*4] * amount;
                output[i+c] = Math.min(255, Math.max(0, val));
            }
        }
    }
    return output;
}

function toggleAdjustPanel(){
    let el = document.getElementById("adjustPanel");
    el.style.display = el.style.display === "none" ? "block" : "none";
}

function autoEnhance(){
    if(!app.imageLoaded || !app.originalImageData){
        alert("Please upload an image first.");
        return;
    }

    let data = app.originalImageData.data;
    let len = data.length;
    let rSum=0, gSum=0, bSum=0, r2Sum=0, g2Sum=0, b2Sum=0;
    let brightPixels = 0; // pixels > 200
    let darkPixels = 0;   // pixels < 50

    for(let i=0; i<len; i+=4){
        let r=data[i], g=data[i+1], b=data[i+2];
        rSum += r; gSum += g; bSum += b;
        r2Sum += r*r; g2Sum += g*g; b2Sum += b*b;
        let avg = (r+g+b)/3;
        if(avg > 200) brightPixels++;
        if(avg < 50) darkPixels++;
    }

    let pixelCount = len/4;
    let rMean = rSum/pixelCount, gMean = gSum/pixelCount, bMean = bSum/pixelCount;
    let rStd = Math.sqrt(r2Sum/pixelCount - rMean*rMean);
    let gStd = Math.sqrt(g2Sum/pixelCount - gMean*gMean);
    let bStd = Math.sqrt(b2Sum/pixelCount - bMean*bMean);
    let meanGray = (rMean + gMean + bMean)/3;

    // Auto brightness: center around 128
    let brightness = Math.round(128 - meanGray);
    brightness = Math.max(-60, Math.min(60, brightness));

    // Auto contrast: boost if image is flat (low std)
    let avgStd = (rStd + gStd + bStd)/3;
    let contrast = 0;
    if(avgStd < 40) contrast = Math.round((40 - avgStd) * 1.5);
    if(avgStd > 70) contrast = Math.round((70 - avgStd) * 0.5);
    contrast = Math.max(-30, Math.min(50, contrast));

    // Auto gamma: brighten if too dark, darken if washed out
    let gamma = 100;
    if(meanGray < 100) gamma = Math.round(100 + (100 - meanGray) * 0.6);
    else if(meanGray > 180) gamma = Math.round(100 - (meanGray - 180) * 0.4);
    gamma = Math.max(70, Math.min(140, gamma));

    // Auto temperature: correct color cast
    // If image is too yellow (R high, B low) → cool it down
    // If image is too blue (B high, R low) → warm it up
    let temp = 0;
    let rbDiff = rMean - bMean;
    if(rbDiff > 15) temp = Math.round(-rbDiff * 0.8); // too warm/yellow → cool
    else if(rbDiff < -15) temp = Math.round(-rbDiff * 0.8); // too cool/blue → warm
    temp = Math.max(-40, Math.min(40, temp));

    // Auto whiten: if there are many bright pixels (background), boost them
    let white = 0;
    let brightRatio = brightPixels / pixelCount;
    if(brightRatio > 0.15){
        white = Math.round((brightRatio - 0.15) * 200);
        white = Math.min(60, white);
    }

    // Auto saturation: boost slightly for phone camera images
    let sat = 15;

    // Auto sharpen: light sharpening for crisp nuclei
    let sharp = 25;

    // Apply values
    document.getElementById("brightSlider").value = brightness;
    document.getElementById("contrastSlider").value = contrast;
    document.getElementById("gammaSlider").value = gamma;
    document.getElementById("satSlider").value = sat;
    document.getElementById("sharpSlider").value = sharp;
    document.getElementById("whiteSlider").value = white;
    document.getElementById("tempSlider").value = temp;

    adjustImage();

    // Show the panel so user can see what was adjusted
    document.getElementById("adjustPanel").style.display = "block";

    console.log(`Auto-Enhance: brightness=${brightness}, contrast=${contrast}, gamma=${gamma/100}, sat=${sat}, sharp=${sharp}, white=${white}, temp=${temp}`);
}

function resetAdjustments(){
    document.getElementById("brightSlider").value = 0;
    document.getElementById("contrastSlider").value = 0;
    document.getElementById("gammaSlider").value = 100;
    document.getElementById("satSlider").value = 0;
    document.getElementById("sharpSlider").value = 0;
    document.getElementById("whiteSlider").value = 0;
    document.getElementById("tempSlider").value = 0;
    adjustImage();
}

function applyAdjustments(){
    // Lock in current adjustments as the new "original"
    app.originalImageData = imageCtx.getImageData(0,0,imageCanvas.width,imageCanvas.height);
    app.adjustmentsApplied = true;
    alert("Adjustments applied. AI will now analyze the adjusted image.");
}

// ===============================
// MOUSE INTERACTION
// ===============================
let selectedMarker=null;
let movingMarker=false;
let mouseDownPos=null;
let hasDragged=false;

imageCanvas.addEventListener("pointerdown",function(e){
    // Mouse: left button only. Middle/right are reserved for panning.
    if(e.pointerType==="mouse" && e.button!==0) return;
    try{ imageCanvas.setPointerCapture(e.pointerId); }catch(err){}

    let p=screenToImage(e);
    mouseDownPos=p;
    hasDragged=false;

    if(app.roiDrawing){
        app.roi={points:[{x:p.x,y:p.y}]};
        app.roiDrawingActive=true;
        app.roiStart=p;
        return;
    }

    // ERASE MODE: start brush erase
    if(app.mode==="erase"){
        app.erasing=true;
        app.erasedBatch=[];
        eraseAtPoint(p.x,p.y);
        return;
    }

    selectedMarker=null;
    for(let i=0;i<app.markers.length;i++){
        let m=app.markers[i];
        let dx=m.x-p.x;
        let dy=m.y-p.y;
        let d=Math.sqrt(dx*dx+dy*dy);
        if(d<15){
            selectedMarker=m;
            movingMarker=true;
            break;
        }
    }
});

imageCanvas.addEventListener("pointermove",function(e){
    let p=screenToImage(e);

    if(app.roiDrawingActive){
        let last=app.roi.points[app.roi.points.length-1];
        let dx=p.x-last.x,dy=p.y-last.y;
        if(Math.sqrt(dx*dx+dy*dy)>3){
            app.roi.points.push({x:p.x,y:p.y});
        }
        redraw();
        return;
    }

    // ERASE MODE: brush erase while dragging
    if(app.erasing && app.mode==="erase"){
        eraseAtPoint(p.x,p.y);
        return;
    }

    if(movingMarker && selectedMarker){
        selectedMarker.x=p.x;
        selectedMarker.y=p.y;
        hasDragged=true;
        redraw();
    }
});

imageCanvas.addEventListener("pointerup",function(e){
    if(app.roiDrawingActive){
        app.roiDrawingActive=false;
        app.roiDrawing=false;
        if(app.roi.points.length<3){
            app.roi=null; // too small, cancel
        }
        viewer.style.cursor="default";
        setMode(app.mode); // restore mode text
        redraw();
        return;
    }

    // Commit batch erase to undo stack
    if(app.erasing && app.mode==="erase"){
        app.erasing=false;
        if(app.erasedBatch.length>0){
            app.undoStack.push({action:"remove", markers:[...app.erasedBatch]});
            app.redoStack=[];
        }
        app.erasedBatch=[];
        return;
    }

    // Only place markers on click (not drag)
    if(!movingMarker && !hasDragged && mouseDownPos && app.mode!=="erase"){
        let p=screenToImage(e);
        addMarker(p.x,p.y,app.mode);
    }

    movingMarker=false;
    selectedMarker=null;
    hasDragged=false;
    mouseDownPos=null;
});

// ===============================
// FIT WINDOW ON RESIZE
// ===============================
window.onresize=function(){
    if(app.imageLoaded) fitImage();
};

// ===============================
// SHORTCUTS
// ===============================
document.addEventListener("keydown",function(e){
    switch(e.key){
        case "1": setMode("pos"); break;
        case "2": setMode("neg"); break;
        case "3": setMode("erase"); break;
        case "r": startROI(); break;
        case "Escape":
            if(app.roiDrawing || app.roiDrawingActive){
                app.roiDrawing=false;
                app.roiDrawingActive=false;
                if(!app.roi || !app.roi.points || app.roi.points.length<3) app.roi=null;
                viewer.style.cursor="default";
                setMode(app.mode);
                redraw();
            }
            break;
        case "z":
            if(e.ctrlKey || e.metaKey){
                e.preventDefault();
                undo();
            }
            break;
        case "y":
            if(e.ctrlKey || e.metaKey){
                e.preventDefault();
                redo();
            }
            break;
    }
});

// =======================================
// NUCLY v2 AI ENGINE
// =======================================
function runAI(){
    if(!app.imageLoaded){
        alert("Please upload an image first");
        return;
    }
    if(typeof cv === "undefined"){
        alert("OpenCV is not ready");
        return;
    }
    if(app.aiRunning) return;

    clearAIMarkers();
    app.aiRunning=true;
    let es = document.getElementById("engineStatus");
    es.style.display = "inline";
    es.style.opacity = "1";
    es.innerHTML = "🧠 AI analysing...";

    setTimeout(function(){
        try{
            prepareAIImage();
            redraw();
            updateCount();
            showAIReport();
            mergeDuplicateAIMarkers();
            redraw();
            updateCount();
        } catch(error){
            console.error(error);
            alert(error.message);
        }
        app.aiRunning=false;
        let es2 = document.getElementById("engineStatus");
    es2.innerHTML = "✅ AI Complete";
    es2.style.opacity = "0.3";
    setTimeout(function(){ es2.style.display = "none"; }, 1500);
    },100);
}

function prepareAIImage(){
    let src = cv.imread(imageCanvas);
    let working = new cv.Mat();
    src.copyTo(working);

    let rgb = new cv.Mat();
    cv.cvtColor(working, rgb, cv.COLOR_RGBA2RGB);
    analyzeNuclei(rgb);

    src.delete();
    working.delete();
    rgb.delete();
}

function preprocessImage(src){
    let result = new cv.Mat();
    cv.GaussianBlur(src, result, new cv.Size(3,3), 0);
    return result;
}

function analyzeNuclei(src){
    let hsv = new cv.Mat();
    cv.cvtColor(src, hsv, cv.COLOR_RGB2HSV);

    let dabSensitivity = Number(document.getElementById("dabLevel").value);
    let blueSensitivity = Number(document.getElementById("blueLevel").value);
    let minSize = Number(document.getElementById("minNucleus").value);

    // --- POSITIVE (DAB+) nuclei detection ---
    // DAB positive can be brown, dark brown, blackish, greyish
    // We combine three HSV ranges and OR them together

    let posMask = new cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8U);

    // Range 1: Classic brown (orange-brown to dark brown)
    let brownLow1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(0, Math.max(10, dabSensitivity-15), 15, 0));
    let brownHigh1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(40, 255, 240, 255));
    let mask1 = new cv.Mat();
    cv.inRange(hsv, brownLow1, brownHigh1, mask1);
    cv.bitwise_or(posMask, mask1, posMask);

    // Range 2: Dark / blackish nuclei (low value, low saturation, broad hue)
    let brownLow2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(0, 0, 0, 0));
    let brownHigh2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(180, Math.max(20, dabSensitivity-25), 80, 255));
    let mask2 = new cv.Mat();
    cv.inRange(hsv, brownLow2, brownHigh2, mask2);
    cv.bitwise_or(posMask, mask2, posMask);

    // Range 3: Greyish / desaturated brown (medium value, low saturation)
    let brownLow3 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(0, 5, 40, 0));
    let brownHigh3 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(50, Math.max(15, dabSensitivity-10), 180, 255));
    let mask3 = new cv.Mat();
    cv.inRange(hsv, brownLow3, brownHigh3, mask3);
    cv.bitwise_or(posMask, mask3, posMask);

    // Range 4: PURPLE / PLUM POSITIVE
    // OpenCV HSV hue is 0-179; hue around 159 is included here.
    let purpleLow = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(150, Math.max(10, dabSensitivity-20), 20, 0));
    let purpleHigh = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(175, 255, 230, 255));
    let mask4 = new cv.Mat();
    cv.inRange(hsv, purpleLow, purpleHigh, mask4);
    cv.bitwise_or(posMask, mask4, posMask);

    // Range 5: WEAK / BLUSH DAB (very pale brown, low saturation, medium-high value)
    // Detected separately so observer can decide whether to count as positive
    let blushLow = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(10, Math.max(5, dabSensitivity-30), 60, 0));
    let blushHigh = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(45, Math.max(25, dabSensitivity), 220, 255));
    let blushMask = new cv.Mat();
    cv.inRange(hsv, blushLow, blushHigh, blushMask);

    // --- NEGATIVE (hematoxylin / blue) nuclei ---
    let blueLow = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(80, blueSensitivity, 20, 0));
    let blueHigh = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(148, 255, 255, 255));
    let blueMask = new cv.Mat();
    cv.inRange(hsv, blueLow, blueHigh, blueMask);

    let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.morphologyEx(posMask, posMask, cv.MORPH_OPEN, kernel);
    cv.morphologyEx(blueMask, blueMask, cv.MORPH_OPEN, kernel);

    detectNuclei(posMask, "pos", minSize);
    detectNuclei(blueMask, "neg", minSize);

    brownLow1.delete(); brownHigh1.delete(); mask1.delete();
    brownLow2.delete(); brownHigh2.delete(); mask2.delete();
    brownLow3.delete(); brownHigh3.delete(); mask3.delete();
    purpleLow.delete(); purpleHigh.delete(); mask4.delete();
    blushLow.delete(); blushHigh.delete(); blushMask.delete();

    hsv.delete();
    blueLow.delete();
    blueHigh.delete();
    posMask.delete();
    blueMask.delete();
    kernel.delete();
}

// =======================================
// WATERSHED NUCLEUS SEPARATOR
// Splits clumped/touching nuclei before counting
// =======================================
function separateNuclei(mask){
    // Distance transform: bright peaks = centers of nuclei
    let dist = new cv.Mat();
    cv.distanceTransform(mask, dist, cv.DIST_L2, 5);

    // Normalize for visualization/processing
    let distNorm = new cv.Mat();
    cv.normalize(dist, distNorm, 0, 255, cv.NORM_MINMAX, cv.CV_8U);

    // Threshold to find peaks (nucleus centers)
    // The threshold determines how aggressive the splitting is
    let peaks = new cv.Mat();
    // Adaptive: use a higher percentage of max distance
    // Higher threshold = more conservative splitting (fewer fragments)
    let minPeakVal = Math.max(15, cv.minMaxLoc(distNorm).maxVal * 0.45);
    cv.threshold(distNorm, peaks, minPeakVal, 255, cv.THRESH_BINARY);

    // Dilate peaks slightly to ensure they cover nucleus centers
    let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(peaks, peaks, kernel);

    // Find connected components of peaks = markers for watershed
    let markers = new cv.Mat();
    let stats = new cv.Mat();
    let centroids = new cv.Mat();
    let numLabels = cv.connectedComponentsWithStats(peaks, markers, stats, centroids);

    // Watershed requires markers to be int32 and background = 1
    let markers32 = new cv.Mat();
    markers.convertTo(markers32, cv.CV_32S);
    // connectedComponents labels background as 0; watershed expects it as 1
    // So we add 1 to all labels
    for(let y=0; y<markers32.rows; y++){
        for(let x=0; x<markers32.cols; x++){
            markers32.intPtr(y,x)[0] += 1;
        }
    }

    // Prepare 3-channel image for watershed
    let mask3ch = new cv.Mat();
    cv.cvtColor(mask, mask3ch, cv.COLOR_GRAY2BGR);

    // Run watershed
    cv.watershed(mask3ch, markers32);

    // Extract separated regions: each label > 1 becomes a nucleus
    let separated = new cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8U);
    for(let y=0; y<markers32.rows; y++){
        for(let x=0; x<markers32.cols; x++){
            let label = markers32.intPtr(y,x)[0];
            if(label > 1){
                separated.ucharPtr(y,x)[0] = 255;
            }
        }
    }

    // Clean up small fragments
    cv.morphologyEx(separated, separated, cv.MORPH_OPEN, kernel);

    dist.delete(); distNorm.delete(); peaks.delete();
    kernel.delete(); markers.delete(); markers32.delete();
    mask3ch.delete(); stats.delete(); centroids.delete();

    return separated;
}

function detectNuclei(mask,type,minSize){
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    for(let i=0; i<contours.size(); i++){
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        // More flexible area bounds: minSize to 50x minSize (was 100x, too large)
        let maxSize = Math.max(minSize*50, 500);
        if(area < minSize || area > maxSize) continue;

        // Use true centroid (center of mass) instead of bounding box center
        // This places the dot precisely on the nucleus, not on a rough rectangle
        let M = cv.moments(contour);
        if(M.m00 === 0) continue;
        let cx = M.m10 / M.m00;
        let cy = M.m01 / M.m00;

        // Filter by polygon ROI if active
        if(!isPointInROI(cx,cy)){
            continue;
        }

        // Larger deduplication radius for high-res phone camera images
        // where nuclei may appear bigger and closer together
        if(!aiMarkerExists(cx,cy)){
            addAIMarker(cx,cy,type);
        }
    }
    contours.delete();
    hierarchy.delete();
}

function addAIMarker(x,y,type){
    let marker={
        id:Date.now()+Math.random(),
        x:x,
        y:y,
        type:type,
        source:"AI"
    };
    app.markers.push(marker);
    app.aiMarkers.push(marker);
}

function aiMarkerExists(x,y){
    // Larger threshold for phone camera images where nuclei are bigger
    // and watershed may create nearby fragments of the same nucleus
    let limit = Math.max(20, app.markerSize * 2.5);
    return app.markers.some(m=>{
        let dx=m.x-x;
        let dy=m.y-y;
        return Math.sqrt(dx*dx+dy*dy) < limit;
    });
}

// Post-merge: collapse any AI markers that are too close after detection
// This catches cases where watershed fragments or contour splitting
// created multiple dots on one nucleus
function mergeDuplicateAIMarkers(){
    let merged = [];
    let aiOnly = app.markers.filter(m=>m.source==="AI");
    let visited = new Set();

    for(let i=0;i<aiOnly.length;i++){
        if(visited.has(i)) continue;
        let group = [aiOnly[i]];
        visited.add(i);

        // Find all nearby AI markers of same type
        for(let j=i+1;j<aiOnly.length;j++){
            if(visited.has(j)) continue;
            if(aiOnly[i].type !== aiOnly[j].type) continue;
            let dx=aiOnly[i].x-aiOnly[j].x;
            let dy=aiOnly[i].y-aiOnly[j].y;
            if(Math.sqrt(dx*dx+dy*dy) < 25){
                group.push(aiOnly[j]);
                visited.add(j);
            }
        }

        // Merge group into centroid
        if(group.length===1){
            merged.push(group[0]);
        } else {
            let cx=0,cy=0;
            group.forEach(m=>{cx+=m.x;cy+=m.y;});
            cx/=group.length; cy/=group.length;
            merged.push({
                id:Date.now()+Math.random(),
                x:cx, y:cy,
                type:group[0].type,
                source:"AI"
            });
        }
    }

    // Replace AI markers with merged set, keep manual markers
    app.markers = app.markers.filter(m=>m.source!=="AI").concat(merged);
    app.aiMarkers = merged;
}

function clearAIMarkers(){
    app.markers = app.markers.filter(m=>m.source!=="AI");
    app.aiMarkers=[];
    redraw();
    updateCount();
}

function showAIReport(){
    let aiPositive = app.aiMarkers.filter(m=>m.type==="pos").length;
    let aiNegative = app.aiMarkers.filter(m=>m.type==="neg").length;
    let total = aiPositive+aiNegative;
    let ki = total ? ((aiPositive/total)*100).toFixed(1) : 0;
    console.log(`NUCLY IHC AI REPORT\nAI Positive: ${aiPositive}\nAI Negative: ${aiNegative}\nAI IHC Index: ${ki}%`);
}

function filterAIConfidence(minConfidence){
    app.markers = app.markers.filter(m=>{
        if(m.source==="AI" && m.confidence){
            return m.confidence >= minConfidence;
        }
        return true;
    });
    redraw();
    updateCount();
}

function exportAIReport(){
    let text = `NUCLY v2 IHC Report\nPositive nuclei: ${document.getElementById("positiveCount").innerHTML}\nNegative nuclei: ${document.getElementById("negativeCount").innerHTML}\nIHC Index: ${document.getElementById("ki67Value").innerHTML}`;
    let blob = new Blob([text], {type:"text/plain"});
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "NUCLY_IHC_Report.txt";
    link.click();
}

// =======================================
// EXPORT & SESSION
// =======================================
function exportAnnotatedPNG(){
    if(!app.imageLoaded){ alert("No image loaded"); return; }
    let exportCanvas = document.createElement("canvas");
    exportCanvas.width = imageCanvas.width;
    exportCanvas.height = imageCanvas.height;
    let ctx = exportCanvas.getContext("2d");
    ctx.drawImage(imageCanvas,0,0);
    ctx.drawImage(overlayCanvas,0,0);
    let link = document.createElement("a");
    link.download = "NUCLY_Annotated_Result.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
}

function exportCSV(){
    let csv = "ID,X,Y,Type,Source\n";
    app.markers.forEach(m=>{
        csv += `${m.id},${m.x},${m.y},${m.type},${m.source}\n`;
    });
    let blob = new Blob([csv], {type:"text/csv"});
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "NUCLY_Markers.csv";
    link.click();
}

function saveSession(){
    let session={
        version:"NUCLY v2",
        date: new Date().toISOString(),
        markers: app.markers,
        roi: app.roi,
        zoom: app.zoom
    };
    let blob = new Blob([JSON.stringify(session,null,2)], {type:"application/json"});
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "NUCLY_session.json";
    link.click();
}

function loadSessionFile(file){
    let reader = new FileReader();
    reader.onload=function(e){
        let session = JSON.parse(e.target.result);
        app.markers = session.markers || [];
        app.roi = session.roi || null;
        app.zoom = session.zoom || 1;
        redraw();
        updateCount();
    };
    reader.readAsText(file);
}

function toggleDarkMode(){
    document.body.classList.toggle("dark");
}

function enableDarkMode(){
    document.body.style.background="#111";
    document.body.style.color="#eee";
    document.querySelectorAll(".panel").forEach(p=>{
        p.style.background="#222";
        p.style.color="#eee";
    });
}

function disableDarkMode(){
    document.body.style.background="#e9e9e9";
    document.body.style.color="#000";
    document.querySelectorAll(".panel").forEach(p=>{
        p.style.background="#fff";
        p.style.color="#000";
    });
}

function getStatistics(){
    let stats={
        positive: app.markers.filter(m=>m.type==="pos").length,
        negative: app.markers.filter(m=>m.type==="neg").length,
        ai: app.markers.filter(m=>m.source==="AI").length,
        manual: app.markers.filter(m=>m.source==="manual").length
    };
    stats.total = stats.positive + stats.negative;
    stats.ki67 = stats.total ? ((stats.positive/stats.total)*100).toFixed(1) : 0;
    return stats;
}

function toggleAbout(){
    let el=document.getElementById("aboutPanel");
    let guide=document.getElementById("guidePanel");
    if(el.style.display==="none"){
        el.style.display="block";
        guide.style.display="none";
    } else {
        el.style.display="none";
    }
}
function toggleGuide(){
    let el=document.getElementById("guidePanel");
    let about=document.getElementById("aboutPanel");
    if(el.style.display==="none"){
        el.style.display="block";
        about.style.display="none";
    } else {
        el.style.display="none";
    }
}

function exportPDFReport(){
    let pos = app.markers.filter(m=>m.type==="pos");
    let weak = app.markers.filter(m=>m.type==="weak");
    let neg = app.markers.filter(m=>m.type==="neg");
    let ai = app.markers.filter(m=>m.source==="AI");
    let manual = app.markers.filter(m=>m.source==="manual");
    let total = pos.length + weak.length + neg.length;
    let ki = total ? ((pos.length/total)*100).toFixed(1) : 0;
    let kiAll = total ? (((pos.length+weak.length)/total)*100).toFixed(1) : 0;

    let report = `<html><head><title>NUCLY IHC Report</title>
    <style>body{font-family:Arial;padding:30px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #777;padding:8px;}</style>
    </head><body>
    <h1>NUCLY v2</h1>
    <h2>IHC Nuclear Counter Report</h2>
    <p>Date: ${new Date().toLocaleString()}</p>
    <table>
    <tr><th>Parameter</th><th>Result</th></tr>
    <tr><td>Strong Positive nuclei</td><td>${pos.length}</td></tr>
    <tr><td>Weak / Blush nuclei</td><td>${weak.length}</td></tr>
    <tr><td>Negative nuclei</td><td>${neg.length}</td></tr>
    <tr><td>IHC Index (Strong)</td><td>${ki}%</td></tr>
    <tr><td>IHC Index (All Positive)</td><td>${kiAll}%</td></tr>
    <tr><td>AI detected markers</td><td>${ai.length}</td></tr>
    <tr><td>Manual markers</td><td>${manual.length}</td></tr>
    </table>
    <h3>ROI</h3>
    <p>${app.roi && app.roi.points ? `${app.roi.points.length} vertices (freehand)` : "No ROI selected"}</p>
    </body></html>`;

    let win = window.open("");
    win.document.write(report);
    win.document.close();
    setTimeout(function(){ win.print(); },500);
}

/* ==========================================================================
   NUCLY — installable console layer
   Added when NUCLY became an installable app. Everything below adapts the
   original counting engine to touch screens, pointer gestures and offline
   use. The counting and detection maths above is untouched.
   ========================================================================== */

// ---------------------------------------------------------------- utilities
function $(id){ return document.getElementById(id); }

let toastTimer = null;
function toast(message, opts){
    opts = opts || {};
    let el = $("toast");
    if(!el) return;
    el.innerHTML = "";
    let text = document.createElement("span");
    text.innerHTML = message;
    el.appendChild(text);

    if(opts.actionLabel){
        let btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--sm";
        btn.style.marginLeft = "12px";
        btn.textContent = opts.actionLabel;
        btn.onclick = function(){
            hideToast();
            if(opts.onAction) opts.onAction();
        };
        el.appendChild(btn);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.timeout || 4200);
}
function hideToast(){
    let el = $("toast");
    if(el){ el.hidden = true; el.innerHTML = ""; }
}

// ------------------------------------------------------------- mode plumbing
const MARKER_TYPES = ["pos", "weak", "neg"];

function syncModeButtons(mode){
    document.querySelectorAll("[data-mode]").forEach(function(btn){
        let on = btn.getAttribute("data-mode") === mode;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.body.classList.remove("mode-pos", "mode-weak", "mode-neg", "mode-erase", "mode-pan", "mode-roi");
    document.body.classList.add("mode-" + mode);
}

const baseSetMode = setMode;
setMode = function(m){
    baseSetMode(m);
    if(m === "pan") $("currentMode").innerHTML = "Pan / inspect";
    if(m === "pos") $("currentMode").innerHTML = "Strong positive";
    // Cursors are driven by body classes in CSS, not inline styles.
    imageCanvas.style.cursor = "";
    viewer.style.cursor = "";
    syncModeButtons(m);
};

const baseStartROI = startROI;
startROI = function(){
    baseStartROI();
    viewer.style.cursor = "";
    syncModeButtons("roi");
};

// Marks may only be placed inside the field of view, and only as a real
// nuclear class — the surround around a fitted image is not countable.
const baseAddMarker = addMarker;
addMarker = function(x, y, type){
    if(MARKER_TYPES.indexOf(type) === -1) return;
    if(x < 0 || y < 0 || x > imageCanvas.width || y > imageCanvas.height) return;
    baseAddMarker(x, y, type);
};

const baseUpdateCount = updateCount;
updateCount = function(){
    baseUpdateCount();
    scheduleAutosave();
};

// ------------------------------------------------------------ pan and zoom
function clampPan(){
    let vw = viewer.clientWidth;
    let vh = viewer.clientHeight;
    let iw = imageCanvas.width * app.zoom;
    let ih = imageCanvas.height * app.zoom;
    app.pan.x = iw <= vw ? (vw - iw) / 2 : Math.min(0, Math.max(vw - iw, app.pan.x));
    app.pan.y = ih <= vh ? (vh - ih) / 2 : Math.min(0, Math.max(vh - ih, app.pan.y));
}

function zoomAt(factor, cx, cy){
    if(!app.imageLoaded) return;
    let before = app.zoom;
    app.zoom = before * factor;
    limitZoom();
    let k = app.zoom / before;
    app.pan.x = cx - (cx - app.pan.x) * k;
    app.pan.y = cy - (cy - app.pan.y) * k;
    clampPan();
    updateTransform();
}

function zoomToCentre(factor){
    zoomAt(factor, viewer.clientWidth / 2, viewer.clientHeight / 2);
}

zoomIn = function(){ zoomToCentre(1.2); };
zoomOut = function(){ zoomToCentre(1 / 1.2); };

fitImage = function(){
    if(!app.imageLoaded) return;
    let ratio = Math.min(viewer.clientWidth / imageCanvas.width, viewer.clientHeight / imageCanvas.height);
    app.minZoom = Math.min(0.1, ratio * 0.75);
    app.fitZoom = ratio;
    app.zoom = ratio;
    limitZoom();
    clampPan();
    updateTransform();
};

$("zoomSlider").oninput = function(){
    if(!app.imageLoaded) return;
    let target = Number(this.value) / 100;
    zoomToCentre(target / app.zoom);
};

// --------------------------------------------------- pointer gesture layer
// One finger marks, erases or traces. Two fingers always pinch and pan, on
// any mode. In Pan mode (or with the middle mouse button) one pointer pans.
// Gestures are intercepted in the capture phase so the single-pointer
// handlers above never see a pan or a pinch.
const pointers = new Map();
let gesture = null;            // null | "pan" | "pinch" | "locked"
let panFrom = null;
let pinchFrom = null;

function pointerList(){
    return Array.from(pointers.values());
}

function centreOf(list){
    let rect = viewer.getBoundingClientRect();
    let sx = 0, sy = 0;
    list.forEach(function(p){ sx += p.x; sy += p.y; });
    return { x: sx / list.length - rect.left, y: sy / list.length - rect.top };
}

function spreadOf(list){
    let dx = list[0].x - list[1].x;
    let dy = list[0].y - list[1].y;
    return Math.max(1, Math.sqrt(dx * dx + dy * dy));
}

// Abandon whatever the single-pointer handlers had started, committing an
// erase batch to the undo stack so a stray second finger cannot lose work.
function abortSingleGesture(){
    if(app.erasing){
        app.erasing = false;
        if(app.erasedBatch.length > 0){
            app.undoStack.push({ action: "remove", markers: app.erasedBatch.slice() });
            app.redoStack = [];
        }
        app.erasedBatch = [];
    }
    if(app.roiDrawingActive){
        app.roiDrawingActive = false;
        app.roiDrawing = false;
        if(!app.roi || !app.roi.points || app.roi.points.length < 3) app.roi = null;
        setMode(app.mode);
    }
    movingMarker = false;
    selectedMarker = null;
    mouseDownPos = null;
    hasDragged = false;
    redraw();
    updateCount();
}

function beginPinch(){
    let list = pointerList();
    if(list.length < 2) return;
    gesture = "pinch";
    pinchFrom = {
        spread: spreadOf(list),
        zoom: app.zoom,
        centre: centreOf(list),
        pan: { x: app.pan.x, y: app.pan.y }
    };
}

function beginPan(ev){
    gesture = "pan";
    panFrom = { x: ev.clientX, y: ev.clientY, pan: { x: app.pan.x, y: app.pan.y } };
    document.body.classList.add("is-panning");
}

viewer.addEventListener("pointerdown", function(e){
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });

    if(pointers.size >= 2){
        abortSingleGesture();
        beginPinch();
        e.stopPropagation();
        return;
    }
    let wantsPan = app.mode === "pan" || (e.pointerType === "mouse" && e.button === 1);
    if(wantsPan && app.imageLoaded){
        beginPan(e);
        try{ viewer.setPointerCapture(e.pointerId); }catch(err){}
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

viewer.addEventListener("pointermove", function(e){
    let rec = pointers.get(e.pointerId);
    if(rec){ rec.x = e.clientX; rec.y = e.clientY; }

    if(gesture === "pinch"){
        let list = pointerList();
        if(list.length >= 2){
            let spread = spreadOf(list);
            let k = spread / pinchFrom.spread;
            let before = app.zoom;
            app.zoom = pinchFrom.zoom * k;
            limitZoom();
            // Keep the pinch midpoint anchored, then follow it as it drifts.
            let scale = app.zoom / pinchFrom.zoom;
            let c = pinchFrom.centre;
            let now = centreOf(list);
            app.pan.x = now.x - (c.x - pinchFrom.pan.x) * scale;
            app.pan.y = now.y - (c.y - pinchFrom.pan.y) * scale;
            if(before !== app.zoom || true){
                clampPan();
                updateTransform();
            }
        }
        e.stopPropagation();
        return;
    }

    if(gesture === "pan" && panFrom){
        app.pan.x = panFrom.pan.x + (e.clientX - panFrom.x);
        app.pan.y = panFrom.pan.y + (e.clientY - panFrom.y);
        clampPan();
        updateTransform();
        e.stopPropagation();
        return;
    }

    if(gesture === "locked") e.stopPropagation();
}, true);

function endPointer(e){
    pointers.delete(e.pointerId);
    if(gesture === "pinch" || gesture === "pan" || gesture === "locked"){
        e.stopPropagation();
        // A finger left over after a pinch must not start marking.
        gesture = pointers.size > 0 ? "locked" : null;
        if(pointers.size === 0){
            panFrom = null;
            pinchFrom = null;
            document.body.classList.remove("is-panning");
        }
    }
}
viewer.addEventListener("pointerup", endPointer, true);
viewer.addEventListener("pointercancel", endPointer, true);

// Wheel zooms at the cursor; trackpad pinch arrives as ctrl+wheel.
viewer.addEventListener("wheel", function(e){
    if(!app.imageLoaded) return;
    e.preventDefault();
    let rect = viewer.getBoundingClientRect();
    let step = e.ctrlKey ? 0.01 : 0.0022;
    let factor = Math.exp(-e.deltaY * step);
    zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

// ------------------------------------------------------------- fullscreen
toggleFullscreen = function(){
    let on = viewer.classList.toggle("fullscreen");
    document.body.classList.toggle("is-fullscreen", on);
    requestAnimationFrame(function(){
        if(app.imageLoaded) fitImage();
    });
};

// Keep the current magnification across viewport changes (phone browser
// chrome sliding in and out fires resize constantly); only re-fit when the
// user was still looking at the fitted view.
let resizeTimer = null;
window.onresize = function(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
        if(!app.imageLoaded) return;
        let wasFitted = app.fitZoom && Math.abs(app.zoom - app.fitZoom) < 0.001;
        if(wasFitted){
            fitImage();
        } else {
            clampPan();
            updateTransform();
        }
    }, 160);
};

// ------------------------------------------------------------ image intake
// Phones produce images far larger than a mobile canvas can hold (Safari
// caps canvas area). Oversized fields are scaled down once, on intake, and
// the working size is reported because detection sizes are in pixels.
const MAX_CANVAS_AREA = 12e6;
const MAX_CANVAS_DIM = 4096;

function workingSizeFor(w, h){
    let scale = Math.min(1, MAX_CANVAS_DIM / Math.max(w, h), Math.sqrt(MAX_CANVAS_AREA / (w * h)));
    if(scale >= 1) return null;
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function calibrateForImage(){
    // Marks and brushes are sized in image pixels; a 12 MP field needs
    // bigger marks than a 0.3 MP crop for them to read on screen at all.
    let base = Math.min(imageCanvas.width, imageCanvas.height);
    app.pxScale = Math.max(1, base / 900);
    app.markerSize = Math.max(6, Math.round(8 * app.pxScale));
    setBrushSize($("brushSize").value);
}

const baseSetBrushSize = setBrushSize;
setBrushSize = function(value){
    let effective = Math.round(Number(value) * (app.pxScale || 1));
    app.brushSize = effective;
    $("brushSizeVal").innerHTML = effective;
    redraw();
};

function clearField(){
    app.markers = [];
    app.aiMarkers = [];
    app.undoStack = [];
    app.redoStack = [];
    app.roi = null;
    app.roiDrawing = false;
    app.roiDrawingActive = false;
    app.pan.x = 0;
    app.pan.y = 0;
}

function finishLoad(fingerprint){
    app.imageLoaded = true;
    setupCanvas();
    calibrateForImage();
    fitImage();
    redraw();
    updateCount();
    let empty = $("emptyState");
    if(empty) empty.hidden = true;
    offerRestore(fingerprint);
}

function loadImageFile(file){
    if(!file) return;
    if(!/^image\//.test(file.type) && !/\.(png|jpe?g|tiff?|bmp|webp)$/i.test(file.name)){
        toast("That file is not an image NUCLY can read.");
        return;
    }
    // A new field must never inherit the previous field's marks.
    clearField();

    let url = URL.createObjectURL(file);
    let probe = new Image();
    probe.onload = function(){
        let target = workingSizeFor(probe.naturalWidth, probe.naturalHeight);
        let fingerprint = [file.name, file.size, probe.naturalWidth + "x" + probe.naturalHeight].join("|");

        if(!target){
            sourceImage = probe;
            URL.revokeObjectURL(url);
            finishLoad(fingerprint);
            return;
        }

        let scratch = document.createElement("canvas");
        scratch.width = target.w;
        scratch.height = target.h;
        scratch.getContext("2d").drawImage(probe, 0, 0, target.w, target.h);
        URL.revokeObjectURL(url);

        let scaled = new Image();
        scaled.onload = function(){
            sourceImage = scaled;
            finishLoad(fingerprint);
            toast("Large photograph scaled to " + target.w + " × " + target.h +
                  " px so it fits this device. Detection sizes are in pixels of this working image.",
                  { timeout: 7000 });
        };
        scaled.src = scratch.toDataURL("image/png");
    };
    probe.onerror = function(){
        URL.revokeObjectURL(url);
        toast("That image could not be decoded on this device.");
    };
    probe.src = url;
}

fileInput.onchange = function(e){ loadImageFile(e.target.files[0]); this.value = ""; };
$("cameraInput").onchange = function(e){ loadImageFile(e.target.files[0]); this.value = ""; };
$("sessionInput").onchange = function(e){
    let file = e.target.files[0];
    if(file){
        loadSessionFile(file);
        toast("Session reopened. Load the matching field if it is not already open.");
    }
    this.value = "";
};

const baseResetImage = resetImage;
resetImage = function(){
    baseResetImage();
    calibrateForImage();
    fitImage();
    syncModeButtons(app.mode);
};

// ------------------------------------------------------- detection guards
const baseRunAI = runAI;
runAI = function(){
    if(!app.imageLoaded){
        toast("Open or photograph a field first.");
        return;
    }
    if(!engineReady){
        toast("The detection engine is still loading. Manual counting works meanwhile.");
        return;
    }
    baseRunAI();
};

const baseAnalyzeROI = analyzeROI;
analyzeROI = function(){
    if(!app.roi || !app.roi.points || app.roi.points.length < 3){
        toast("Trace an ROI first: choose Trace ROI, then draw around the region.");
        return;
    }
    runAI();
};

// ------------------------------------------------- autosave (marks only)
// Only coordinates and classes are stored, never pixels, and only against a
// fingerprint of the field they were counted on.
const AUTOSAVE_KEY = "nucly.autosave.v1";
const AUTOSAVE_LIMIT = 20000;
let autosaveTimer = null;
let currentFingerprint = null;

function scheduleAutosave(){
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(writeAutosave, 700);
}

function writeAutosave(){
    if(!currentFingerprint || !app.imageLoaded) return;
    if(app.markers.length > AUTOSAVE_LIMIT) return;
    try{
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
            fingerprint: currentFingerprint,
            markers: app.markers,
            roi: app.roi,
            savedAt: new Date().toISOString()
        }));
    }catch(err){ /* private mode or quota — counting continues regardless */ }
}

function readAutosave(){
    try{
        let raw = localStorage.getItem(AUTOSAVE_KEY);
        return raw ? JSON.parse(raw) : null;
    }catch(err){ return null; }
}

function offerRestore(fingerprint){
    let saved = readAutosave();
    currentFingerprint = fingerprint;
    if(!saved || saved.fingerprint !== fingerprint) return;
    if(!saved.markers || saved.markers.length === 0) return;

    let when = new Date(saved.savedAt);
    let stamp = isNaN(when.getTime()) ? "earlier" : when.toLocaleString();
    toast(saved.markers.length + " marks were counted on this field (" + stamp + ").", {
        actionLabel: "Restore",
        timeout: 12000,
        onAction: function(){
            app.markers = saved.markers;
            app.roi = saved.roi || null;
            app.undoStack = [];
            app.redoStack = [];
            redraw();
            updateCount();
            toast("Previous count restored.");
        }
    });
}

// ------------------------------------------------------- slider read-outs
[["minNucleus", "minNucleusVal", " px²"], ["dabLevel", "dabLevelVal", ""], ["blueLevel", "blueLevelVal", ""]]
    .forEach(function(pair){
        let input = $(pair[0]);
        let out = $(pair[1]);
        if(!input || !out) return;
        let sync = function(){ out.innerHTML = input.value + pair[2]; };
        input.addEventListener("input", sync);
        sync();
    });

// ------------------------------------------------------- extra shortcuts
document.addEventListener("keydown", function(e){
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    let tag = document.activeElement ? document.activeElement.tagName : "";
    if(tag === "INPUT" && document.activeElement.type !== "range") return;

    if(e.key === "4"){ setMode("weak"); }
    else if(e.key === "p" || e.key === "P"){ setMode("pan"); }
    else if(e.key === "f" || e.key === "F"){ fitImage(); }
    else if(e.key === "Escape" && viewer.classList.contains("fullscreen")){ toggleFullscreen(); }
});

// Panels are sheets now: closing on backdrop click matches the mobile idiom.
["aboutPanel", "guidePanel"].forEach(function(id){
    let sheet = $(id);
    if(!sheet) return;
    sheet.addEventListener("click", function(e){
        if(e.target === sheet) sheet.style.display = "none";
    });
});

// ------------------------------------------------------------------ start
syncModeButtons(app.mode);
updateCount();
