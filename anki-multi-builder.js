const fs = require('fs');
const https = require('https');
const axios = require('axios');
const parser = require('node-html-parser');
const cp = require('node:child_process');


const DEBUGGING = false;
const BASE_URL = "https://wooordhunt.ru"
const DICTIONARY_URL = BASE_URL + "/word/";
const VOCABULARY_FILE_NAME = 'vocabulary.txt';
const SPLITTER = "|";
const BREAKER = "</br>";
const ANKI_URL = "http://127.0.0.1:8765";
const ANKI_APP_PATH = "C:\\apps\\anki\\anki.exe";
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

runAnki();
contactAnki(() => {
    console.info("INFO: starting to transform the vocabulary list into Anki cards...");
    transformVocabularyToCards(VOCABULARY_FILE_NAME);
});

async function runAnki() {
    if(!(await pingAnki())) {
        cp.execFile(`"${ANKI_APP_PATH}"`, {shell:true, windowsHide: true});
    }
}

async function contactAnki(callback) {
    const isReady = await waitAnki(5);

    if(isReady) {
        callback();        
    } else {
        console.error("ERROR: Could not find Anki.")
    } 
}

async function waitAnki(attemptsNumber) {
    for(let i = 0; i < attemptsNumber; i++) {
        if(await pingAnki() === true) {
            console.info(`INFO: Anki is ready`);
            return true;
        } else {
            console.info(`INFO: Waiting for Anki launch...`);
        }
        await delay(1000);
    }
    return false;
}       

async function pingAnki() {
    try {
        console.info("Post request")
        let response = await axios.post(ANKI_URL, {
            "action": "version",
            "version": 6
        });
        if(response.status == 200 && response.data.result == 6) {
            console.info("Recieve 200")
            return true;
        } else {
            console.info("Recieve error")
            return false;
        }
    } catch (error) {
        console.error("Error: ", error);
        return false;
    }
}

function transformVocabularyToCards(fileName) {

    fs.readFile(fileName, 'utf8', async (err, data) => {
        if (err) {
            return console.error(err);
        }
        let lines = data.split(/\r?\n|\r|\n/g);
        let terms = [];
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes(SPLITTER)) {
                console.info(`WARNING: The record "${lines[i]}" does not match the template. Skipping...`);
                continue;
            }
            terms.push(lines[i].slice(1, lines[i].indexOf(SPLITTER)).trim());        
        }

        debug(`${terms.length} terms were retrieved from records.`)
        let responses = await Promise.all(terms.map((term) => axios.get(DICTIONARY_URL + term, { httpsAgent })));
        buildAnkiCards(responses);
    });

}

async function buildAnkiCards(responses) {
    let notes = [];
    for(const response of responses) {
        if (response.status == 200) {
            const note = await transformToNote(response);
            notes.push(note);
        } else {
            console.error(`ERROR: ${response.statusText}`);
        };
    }

    debug(`payloads length: ${notes.length}`);

    debug("notes: " + JSON.stringify(notes))

    console.info(`INFO: Order to build ${notes.length} note(s) was passed to Anki. Please wait...`);
    
    axios.post(ANKI_URL, {
        "action": "multi",
        "version": 6,
        "params": {
            "actions": notes
        }
    })
    .then(function (response) {
        if (response.status != 200) {
            console.error(`ERROR: ${response.statusText}`);
            return;
        }
            
        if (response.data.error !== null) {
            console.error(`ERROR: ${response.data.error}`);
            return;
        }

        for(let i = 0; i < notes.length; i++) {
            let actionResponse = response.data.result[i];
            let term = notes[i].params.note.fields.Term;
            
            if(actionResponse.error == null) {
                console.info(`INFO: ${i+1}. ${term} >> OK`);
            } else {
                console.error(`ERROR: ${i+1}. ${term} >> ${actionResponse.error}`);
            }
            
        }
        notes.map((note) => note.params.note.audio[0].path).forEach((filePath) => fs.unlinkSync(filePath));
        console.info('INFO: Finish. Please close the Anki application or press Ctrl+C');
    })
    .catch(function (error) {
        console.error(`${error}`);
    });
}

async function transformToNote(response) {
    return await assembleNote(retrieveTermData(response));
}

function retrieveTermData(response) {
    let docElement = parser.parse(response.data);
    let headerElement = docElement.querySelector('div#wd_title');
    let termElement = headerElement.querySelector('h2');
    let termInnerHtml = termElement.innerHTML;
    let term = termInnerHtml;//termInnerHtml.slice(0, termInnerHtml.indexOf("<")).trim();
    debug(term);
    let transcriptionElement = headerElement.querySelector('div#us_tr_sound > span.transcription');
    let transcription = transcriptionElement.text.trim();
    debug(transcription);
    let audioSrcElement = headerElement.querySelector('audio#audio_us > source');
    if(audioSrcElement == null) {
        audioSrcElement = headerElement.querySelector('audio#audio_us_1 > source');
        if(audioSrcElement == null) {
            console.info(`WARNING: The term "${term}" has no american sound.`);
        } else {
            console.info(`WARNING: The term "${term}" has a few distinct american sounds.`);
        }
        
    }
    let audioUrl = (audioSrcElement == null) ? "" : BASE_URL + audioSrcElement.getAttribute("src");

    debug(audioUrl);
    let contentElement = docElement.querySelector('div#content_in_russian');
    let definitionElement = contentElement.querySelector('div.t_inline_en');
    let definition = (definitionElement) ? definitionElement.text : "";
    if(!definition.length) {
        console.warn("WARNING: The definition is empty.")
    }
    debug(definition)
    let exampleElements = contentElement.querySelectorAll('p.ex_o');
    let translatedExampleElements = contentElement.querySelectorAll('p.ex_t');
    let len = Math.min(3, exampleElements.length);
    let examples = [];
    let translatedExamples = [];
    for (let i = 0; i < len; i++) {
        examples[i] = exampleElements[i].text.trim();
        translatedExamples[i] = (!!translatedExampleElements[i]) ? translatedExampleElements[i].text.trim() : "";
    }
    let example = (examples.length == 0) ? term : examples.join(BREAKER);
    debug(example);
    let translatedExample = (translatedExamples.length == 0) ? "" : translatedExamples.join(BREAKER);
    debug(translatedExample);

    return { term, transcription, definition, example, translatedExample, audioUrl };
}

async function downloadFile(fileUrl) {
    const fileName = fileUrl.slice(fileUrl.lastIndexOf("/") + 1, fileUrl.length).trim();   

    try {
        const response = await axios({
            method: "get",
            url: fileUrl,
            responseType: "stream",
            httpsAgent: httpsAgent
        });
        response.data.pipe(fs.createWriteStream(fileName));
    } catch {
        return null;
    }
    return __dirname + "\\" + fileName;
}

async function assembleNote(data) {
    const audioPath = await downloadFile(data.audioUrl);
    const audioName = audioPath != null ? audioPath.slice(audioPath.lastIndexOf("\\") + 1, audioPath.length).trim() : null;
    return {
        "action": "addNote",
        "params": {
            "note": {
                "deckName": "Vocabulary",
                "modelName": "Basic With Transcription (and reversed card)",
                "fields": {
                    "Example": data.example,
                    "Translated Example": data.translatedExample,
                    "Term": data.term,
                    "Transcription": data.transcription,
                    "Definition": data.definition
                },
                "options": {
                    "allowDuplicate": false,
                    "duplicateScope": "deck",
                    "duplicateScopeOptions": {
                        "deckName": "Vocabulary",
                        "checkChildren": false,
                        "checkAllModels": false
                    }
                },
                "tags": [
                    "Auto-anki"
                ],
                "audio": [{
                    "path": audioPath,
                    "filename": audioName,
                    "fields": [
                        "Sound"
                    ]
                }]
            }
        }
    };    
}



function debug(msg) {
    if (!DEBUGGING) {
        return;
    }
    console.debug(msg)
}

function delay(milliseconds){
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}