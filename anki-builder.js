const fs = require('fs');
const axios = require('axios');
const parser = require('node-html-parser');

const DEBUGGING = false;
const BASE_URL = "https://wooordhunt.ru"
const DICTIONARY_URL = BASE_URL + "/word/";
const VOCABULARY_FILE_NAME = 'vocabulary.txt';
const SPLITTER = "|";
const BREAKER = "</br>";
const ANKI_URL = "http:localhost:8765";

fs.readFile(VOCABULARY_FILE_NAME, 'utf8', async (err, data) => {
    if (err) {
        return console.error(err);
    }
    var lines = data.split(/\r?\n|\r|\n/g);
    for (var i = 0; i < lines.length; i++) {
        if (!lines[i].includes(SPLITTER)) {
            continue;
        }
        var term = lines[i].slice(1, lines[i].indexOf(SPLITTER)).trim();
        const response = await axios.get(DICTIONARY_URL + term);
        if (response.status == 200) {
            buildAnkiCard(response);
        } else {
            console.error(`ERROR: ${response.statusText}`);
        };
    }
});

async function buildAnkiCard(response) {
    var docElement = parser.parse(response.data);
    var headerElement = docElement.querySelector('div#wd_title');
    var termElement = headerElement.querySelector('h1');
    var termInnerHtml = termElement.innerHTML;
    var term = termInnerHtml.slice(0, termInnerHtml.indexOf("<")).trim();
    debug(term);
    var transcriptionElement = headerElement.querySelector('div#us_tr_sound > span.transcription');
    var transcription = transcriptionElement.text.trim();
    debug(transcription);
    var audioSrcElement = headerElement.querySelector('audio#audio_us > source');
    if(audioSrcElement == null) {
        audioSrcElement = headerElement.querySelector('audio#audio_us_1 > source');
        if(audioSrcElement == null) {
            console.info(`WARNING: Word ${term} has no american sound.`);
        } else {
            console.info(`WARNING: Word ${term} has a few distinct american sounds.`);
        }
        
    }
    var audioUrl = (audioSrcElement == null) ? "" : BASE_URL + audioSrcElement.getAttribute("src");

    debug(audioUrl);
    var contentElement = docElement.querySelector('div#content_in_russian');
    var definitionElement = contentElement.querySelector('div.t_inline_en');
    var definition = definitionElement.text;
    debug(definition)
    var exampleElements = contentElement.querySelectorAll('p.ex_o');
    var len = Math.min(3, exampleElements.length);
    var examples = [];
    for (var i = 0; i < len; i++) {
        examples[i] = exampleElements[i].text.trim();
    }
    debug(examples.join(BREAKER))
    await addAnkiNote(term, transcription, definition, examples.join(BREAKER), audioUrl);
}

async function addAnkiNote(term, transcription, definition, examples, audioUrl) {
    var payload = buildPayload(term, transcription, definition, examples, audioUrl);
    // axios.post(ANKI_URL, payload)
    //     .then((response) => {
    //         if (response.data.result !== null) {
    //             console.info(`${term} >> OK`);
    //         } else {
    //             console.error(`${term} >> ERROR`, response.data.error);
    //         }
    //     }, (error) => {
    //         console.error(`${term} >> ERROR`, error.cause);
    //     });
    await tryAddAnkiNote(payload, 3);
    
}

async function tryAddAnkiNote(payload, attemptsNumber) {
    try {
        const response = await axios.post(ANKI_URL, payload);
        if (response.status == 200) {
            if (response.data.result !== null) {
                console.info(`${payload.params.note.fields.Term} >> OK`);
            } else {
                console.error(`${payload.params.note.fields.Term} >> ERROR`, response.data.error);
            }
        }
    } catch(error) {
        if(attemptsNumber > 0) {
            await delay(3000);
            tryAddAnkiNote(payload, --attemptsNumber);
        } else {
            console.error(error.cause);
        }        
    }
}

function buildPayload(term, transcription, definition, examples, audioUrl) {
    return {
        "action": "addNote",
        "version": 6,
        "params": {
            "note": {
                "deckName": "Vocabulary",
                "modelName": "Basic With Transcription (and reversed card)",
                "fields": {
                    "Example": examples,
                    "Term": term,
                    "Transcription": transcription,
                    "Definition": definition
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
                    "url": audioUrl,
                    "filename": audioUrl.slice(audioUrl.lastIndexOf("/"), audioUrl.length).trim(),
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