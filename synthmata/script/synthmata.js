var tempTitle = [115, 121, 110, 116, 104, 109, 97, 116, 97, 32];
var midi = null;  // global MIDIAccess object
var midiOutPorts = null;

var selectedMidiPort = null;
var selectedMidiChannel = null;

var sysexDumpData = null;  // we have to use this for Volca FM which only reponds to bulk data

var goodFile = null;

var sysexThrottleTimer = null;
var sysexThrottleTimerMs = 300;

function onMIDISuccess(result) {
    console.log("MIDI ready!");
    midi = result;
    storeOutputs(midi)
    if (midiOutPorts.length < 1) {
        onMIDIFailure("No midi ports found")
    }
    console.log(midiOutPorts);
    buildSetupPanel();
    buildSaveLoadSharePanel();
    setupParameterControls();
    fullRefreshSysexData(); // for Volca FM

}

function onMIDIFailure(msg) {
    console.log("Failed to get MIDI access - " + msg);
}

function testTone() {
    if (selectedMidiChannel != null && selectedMidiPort != null) {
        console.log("sending test tone");
        let noteOnMessage = [0x90 | selectedMidiChannel, 60, 0x7f];
        let noteOffMessage = [0x80, 60, 0x7f];
        selectedMidiPort.send(noteOnMessage);
        selectedMidiPort.send(noteOffMessage, window.performance.now() + 1000.0);
    }
}

function buildSetupPanel(midiAccess) {
    // Port selection.
    let former = document.createElement("form");
    former.id = "midiSetupForm"
    let portSelecter = document.createElement("select");
    portSelecter.id = "portSelector";
    portSelecter.onchange = function (event) { selectedMidiPort = midiOutPorts[event.target.value]; console.log(selectedMidiPort); testTone(); };
    former.appendChild(portSelecter);
    midiOutPorts.forEach(
        function (port, idx) {
            let optioner = document.createElement("option");
            optioner.setAttribute("label", port.name);
            optioner.setAttribute("value", idx);
            portSelecter.appendChild(optioner);
        }, this);
    selectedMidiPort = midiOutPorts[0]; // TODO: check there's not a more idiomatic way of doing this

    // Channel selection
    let channelSelector = document.createElement("select");
    channelSelector.onchange = function (event) { selectedMidiChannel = parseInt(event.target.value); console.log(selectedMidiChannel); testTone(); };
    former.appendChild(channelSelector);
    for (let i = 0; i < 16; i++) {
        let optioner = document.createElement("option");
        optioner.setAttribute("label", i + 1);
        optioner.setAttribute("value", i);
        channelSelector.appendChild(optioner);
    }
    selectedMidiChannel = 0;
    document.getElementById("midiSetup").appendChild(former);

}

function buildSaveLoadSharePanel() {
    let container = document.getElementById("saveLoadShare");

    let loadInput = document.createElement("input");
    loadInput.setAttribute("type", "file");
    loadInput.id = "sysexFileChooser"
    loadInput.onchange = checkSysexFileLoad;
    container.appendChild(loadInput);

    let loadButton = document.createElement("button");
    loadButton.id = "sysexLoadButton";
    loadButton.textContent = "Load Sysex";
    loadButton.setAttribute("disabled", true);
    loadButton.onclick = tryLoadSysex;
    container.appendChild(loadButton);

    let saveButton = document.createElement("button");
    saveButton.id = "sysexSaveButton";
    saveButton.textContent = "Save Sysex";
    saveButton.onclick = saveSysex;
    container.appendChild(saveButton); // TODO: hook up event
}

function setupParameterControls() {
    for (let sysexControl of document.getElementsByClassName("sysexParameter")) {
        sysexControl.oninput = handleValueChangeVoiceDump;
    }
}

function fullRefreshSysexData() {
    sysexDumpData = new Array(155); // TODO: probably don't hard code this?
    sysexDumpData.fill(0);
    for (let ele of document.getElementsByClassName("sysexParameter")) {
        let parameterNo = parseInt(ele.dataset.sysexparameterno);
        let value = parseInt(ele.value);

        sysexDumpData[parameterNo] = value & 0x7f;

    }
    // temporary solution for the name
    for (let i = 0; i < 10; i++) {
        sysexDumpData[i + 145] = tempTitle[i] & 0x7f;
    }
    console.log(sysexDumpData);
}

// This would work for a bulk dump of 32 voices... but we probably don't need that
// so adding all that extra data to the html probably wasn't required...
/*
function fullRefreshSysexData(){
  sysexDumpData = new Array(128);
  sysexDumpData.fill(0);
  for(let param of document.getElementsByClassName("sysexParameter")){
    let dumpOffset = parseInt(param.dataset.sysexdumpbytepos);
    let mask = parseInt(param.dataset.sysexdumpbytemask);
    let shift = parseInt(param.dataset.sysexdumpbyteshift);
    let value = parseInt(param.value);

    sysexDumpData[dumpOffset] &= ~(mask << shift);
    sysexDumpData[dumpOffset] |= ((mask & value) << shift);
  }
}
*/

// So, this probably works for the DX-7 (should try on TX81z), but the volca-fm onlt reads bulk data...)
function handleValueChange(event) {
    if (selectedMidiChannel != null && selectedMidiPort != null) {
        if (event.target.classList.contains("sysexParameter")) {
            let ele = event.target;
            let parameterNo = parseInt(ele.dataset.sysexparameterno);
            let value = parseInt(ele.value);

            // build the sysex message
            paramChangeMessage = [
                0xf0,                         // status byte (sysex)
                0x43,                           // id number (Yamaha)
                0x10 | selectedMidiChannel,   // sub status 0b0001_nnnn; n is channel
                0x00 | (parameterNo >> 7),    // 0b0ggg_ggpp ; g is paramater group no. (0 = voice); p is (part of) paramater number
                parameterNo & 0x7f,           // 0b0ppp_pppp ; rest of parameter number
                value & 0x7f,                 // 0b0ddd_dddd ; value data
                0xf7                          // 0b1111_0111 ; EOX
            ]
            //console.log(paramChangeMessage);
            selectedMidiPort.send(paramChangeMessage);
        }
    }
}

function createSysexDumpBuffer() {
    // checksum is a byte which is the twos complement of the sum of the
    // dump data, masked back against 0x7f
    // if i want to micro-optimise this, I can. I don't really want to though.
    let sum = 0;
    for (let i = 0; i < sysexDumpData.length; i++) {
        sum += sysexDumpData[i];
    }
    sum += 0x7f // TODO: remove once operator on-off isn't hardcoded
    sum &= 0xff;
    sum = (~sum) + 1;
    sum &= 0x7f;

    let buffer = [
        0xF0,                         // status - start sysex
        0x43,                         // id - yamaha (67)
        0x00 | selectedMidiChannel,   // 0b0sssnnnn substatus (0), channel (n)
        0x00,                         // format number (0 = 1 voice)
        0x01,                         // 0b0bbbbbbb data byte count msb
        0x1b,                         // 0b0bbbbbbb data byte count lsb
        ...sysexDumpData,
        0x7f,                         // TODO: remove once operator on-off isn't hardcoded
        sum,                          // checksum
        0xf7                          // 0b1111_0111 ; EOX
    ];

    //console.log(buffer);
    return buffer;
}

// volca fm only responds to bulk voice messages, so this version works
// but the handleValueChange doesn't.
function handleValueChangeVoiceDump(event) {
    if (selectedMidiChannel != null && selectedMidiPort != null) {
        if (event.target.classList.contains("sysexParameter")) {
            let ele = event.target;
            let parameterNo = parseInt(ele.dataset.sysexparameterno);
            let value = parseInt(ele.value);

            sysexDumpData[parameterNo] = value & 0x7f;
            sendSysexDump()

        }
    }
}

function sendSysexDump() {
    let buffer = createSysexDumpBuffer();

    if (sysexThrottleTimer != null) {
        clearTimeout(sysexThrottleTimer);
    }
    sysexThrottleTimer = setTimeout(function () {
        selectedMidiPort.send(buffer);
    }, sysexThrottleTimerMs);

}

function saveSysex() {
    let fullDump = createSysexDumpBuffer();
    let buffer = new Uint8ClampedArray(new ArrayBuffer(fullDump.length));
    for (let i = 0; i < fullDump.length; i++) {
        buffer[i] = fullDump[i];
    }

    var file = new Blob([buffer], { type: "application/octet-binary" });
    let a = document.createElement("a");
    let url = URL.createObjectURL(file);
    a.href = url;
    a.download = "dx7_patch.sysex";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 0);
}

function validateSysexData(data) {
    if (data.length != 164) {
        console.log("wrong length");
        return false;  // wrong length
    }
    if (data[0] != 0xF0) {
        console.log("doesn't start with sysex byte");
        return false; // doesn't start with sysex byte
    }
    if (data[1] != 0x43) {
        console.log("not a yamaha sysex");
        return false; // not a yamaha sysex
    }
    if (data[163] != 0xf7) {
        console.log("doesn't end with EOX");
        return false; // doesn't end with EOX
    }
    if (data[2] & 0x70 != 0) {
        console.log("sub status is not correct");
        return false; // sub status is not correct
    }
    if (data[3] != 0) {
        console.log("format isn't voice");
        return false; // format isn't voice
    }
    if (data[4] != 0x01 || data[5] != 0x1b) {
        console.log("length indicator is not correct");
        return false; // length indicator is not correct
    }
    // checksum check

    let sum = 0;
    for (let i = 6; i < 162; i++) {
        sum += data[i];
    }
    sum &= 0xff;
    sum = (~sum) + 1;
    sum &= 0x7f;
    if (sum != data[162]) {
        console.log("checksum failed");
        return false; // checksum failed
    }

    return true;
}

function checkSysexFileLoad(event) {
    let fileList = event.target.files;
    if (fileList.length > 0) {
        let theFile = fileList[0];
        console.log(theFile);
        let reader = new FileReader();
        reader.onload = function (e) {
            let data = new Uint8ClampedArray(e.target.result);
            console.log(data);
            if (validateSysexData(data)) {
                alert("File appears to contain valid sysex data");
                document.getElementById("sysexLoadButton").removeAttribute("disabled");
                goodFile = theFile;
            } else {
                alert("File is not valid sysex data");
                document.getElementById("sysexLoadButton").setAttribute("disabled", true);
                goodFile = null;
            }
        }
        reader.readAsArrayBuffer(theFile);
    }
}

function loadSysex(readerEvent) {
    let data = new Uint8ClampedArray(readerEvent.target.result);
    let paramArray = data.slice(6, 161);
    let paramControls = new Array(...document.getElementsByClassName("sysexParameter"));
    paramControls.forEach(function (element) { element.value = paramArray[element.dataset.sysexparameterno]; })
    sysexDumpData = paramArray;
    sendSysexDump();
}

function tryLoadSysex(event) {
    if (goodFile == null) {
        alert("Please select a sysex file to load");
        return;
    }
    let reader = new FileReader();
    reader.onload = loadSysex;
    reader.readAsArrayBuffer(goodFile);
}

function storeOutputs(midiAccess) {
    midiOutPorts = new Array(...midiAccess.outputs.values());
}

navigator.requestMIDIAccess({ sysex: true }).then(onMIDISuccess, onMIDIFailure)