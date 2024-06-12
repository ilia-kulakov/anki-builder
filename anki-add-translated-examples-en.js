const fs = require('fs');
const axios = require('axios');
const parser = require('node-html-parser');
const cp = require('node:child_process');

const DEBUGGING = false;
const BASE_URL = "https://wooordhunt.ru"
const DICTIONARY_URL = BASE_URL + "/word/";
const SPLITTER = "|";
const BREAKER = "</br>";
const ANKI_URL = "http://127.0.0.1:8765";
const ANKI_APP_PATH = "C:\\apps\\anki\\anki.exe";

runAnki();
contactAnki(() => {
    console.info("INFO: starting to add the translated examples...");
    addTranslatedExamples();  
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

async function addTranslatedExamples() {

    console.info("INFO: Retrieve all notes' ID");
    try {
        const response = await axios.post(ANKI_URL, {
            "action": "findNotes",
            "version": 6,
            "params": {
                "query": "deck:Vocabulary"
            }
        });

        if (response.status != 200) {
            console.error(`ERROR: ${response.statusText}`);
            return;
        }
            
        if (response.data.error !== null) {
            console.error(`ERROR: ${response.data.error}`);
            return;
        }

        console.info(`INFO: Find ${response.data.result.length} notes`);
        updateNotes(response.data.result);
    } catch(error) {
        console.error(`${error}`);
    };
}

async function updateNotes(ids) {
    console.info("INFO: Get notes info...");
    try {
        const response = await axios.post(ANKI_URL, {
                "action": "notesInfo",
                "version": 6,
                "params": {
                    "notes": ids
                }
            });
            
        if (response.status != 200) {
            console.error(`ERROR: ${response.statusText}`);
            return;
        }
            
        if (response.data.error !== null) {
            console.error(`ERROR: ${response.data.error}`);
            return;
        }

        for(let note of response.data.result) {
            updateNote(note);
            await delay(50);
        }
    } catch(error) {
        console.error(`ERROR: ${error}`);
    };
}

async function updateNote(note) {
    let matches = />(.+?)</.exec(note.fields.Term.value);  
    let term = (!!matches) ? matches[1].toLowerCase() : note.fields.Term.value;
    debug("GET data for " + term);
    try {
        const response = await axios.get(DICTIONARY_URL + term.toLowerCase());
        if (response.status != 200) {
            console.error(`ERROR: ${response.statusText}`);
            return;
        }
        
        let dictionaryExamples = retrieveExamples(response);
        let translatedExample = note.fields.Example.value.split(/<.+?>/)
                                .filter(s => s != '')
                                .map(s => s.trim())
                                .map(s => dictionaryExamples[s])
                                .filter(s => !!s)
                                .join(BREAKER);
        updateNoteTranslatedExample(note.noteId, term, translatedExample);
        console.info(`INFO: ${term} was updated successfully`)
    } catch(error) {
        console.error(`ERROR: ${error}. updateNote Term: ` + term);
    };
}

function retrieveExamples(response) {
    let docElement = parser.parse(response.data);
    let contentElement = docElement.querySelector('div#content_in_russian');
    let exampleElements = contentElement.querySelectorAll('p.ex_o');
    let translatedExampleElements = contentElement.querySelectorAll('p.ex_t');
    let len = Math.min(3, exampleElements.length);
    let examples = [];
    for (let i = 0; i < len; i++) {
        if(!!translatedExampleElements[i]) {
            examples[exampleElements[i].text.trim()] = translatedExampleElements[i].text.trim();
        }
    }

    return examples;
}

async function updateNoteTranslatedExample(id, term, translatedExample) {
    if(translatedExample == "") {
        return;
    }
    try {
        const response =  await axios.post(ANKI_URL, {
            "action": "updateNoteFields",
            "version": 6,
            "params": {
                "note": {
                    "id": id,
                    "fields": {
                        "Translated Example": translatedExample
                    }
                }
            }
        });

        if (response.status != 200) {
            console.error(`ERROR: ${response.statusText}`);
            return;
        }
            
        if (response.data.error !== null) {
            console.error(`ERROR: ${response.data.error}`);
            return;
        }
    } catch(error) {
        console.error(`ERROR: ${error}. Term: ` + term);
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