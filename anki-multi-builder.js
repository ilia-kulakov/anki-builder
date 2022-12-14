const fs = require('fs');
const axios = require('axios');
const parser = require('node-html-parser');
const cp = require('node:child_process');

const DEBUGGING = false;
const BASE_URL = "https://wooordhunt.ru"
const DICTIONARY_URL = BASE_URL + "/word/";
const VOCABULARY_FILE_NAME = 'vocabulary.txt';
const SPLITTER = "|";
const BREAKER = "</br>";
const ANKI_URL = "http:localhost:8765";
const ANKI_APP_PATH = "C:\\Program Files\\Anki\\anki.exe";

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
        let response = await axios.post(ANKI_URL, {
            "action": "version",
            "version": 6
        });
        if(response.status == 200 && response.data.result == 6) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
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
        let responses = await Promise.all(terms.map((term) => axios.get(DICTIONARY_URL + term)));
        buildAnkiCards(responses);
    });

}

function buildAnkiCards(responses) {
    let notes = [];
    for(const response of responses) {
        if (response.status == 200) {
            notes.push(transformToNote(response));
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
        console.info('INFO: Finish. Please close the Anki application or press Ctrl+C');
    })
    .catch(function (error) {
        console.error(`${error}`);
    });
}

function transformToNote(response) {
    return assembleNote(retrieveTermData(response));
}

function retrieveTermData(response) {
    let docElement = parser.parse(response.data);
    let headerElement = docElement.querySelector('div#wd_title');
    let termElement = headerElement.querySelector('h1');
    let termInnerHtml = termElement.innerHTML;
    let term = termInnerHtml.slice(0, termInnerHtml.indexOf("<")).trim();
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
    let len = Math.min(3, exampleElements.length);
    let examples = [];
    for (let i = 0; i < len; i++) {
        examples[i] = exampleElements[i].text.trim();
    }
    let example = (examples.length == 0) ? term : examples.join(BREAKER);
    debug(example);

    return { term, transcription, definition, example, audioUrl };
}

function assembleNote(data) {
    let fileName = data.audioUrl.slice(data.audioUrl.lastIndexOf("/"), data.audioUrl.length).trim();
    return {
        "action": "addNote",
        "params": {
            "note": {
                "deckName": "Vocabulary",
                "modelName": "Basic With Transcription (and reversed card)",
                "fields": {
                    "Example": data.example,
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
                    "url": data.audioUrl,
                    "filename": fileName,
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