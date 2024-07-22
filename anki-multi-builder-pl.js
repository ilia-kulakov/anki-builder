const fs = require('fs');
const https = require('https');
const axios = require('axios');
const parser = require('node-html-parser');
const cp = require('node:child_process');

const DEBUGGING = false;
const DICTIONARY_URL = 'https://pl.wiktionary.org/wiki/';
const PROTOCOL = 'https:';
const VOCABULARY_FILE_NAME = 'vocabulary-pl.txt';
const BREAKER = '</br>';
const ANKI_URL = 'http://127.0.0.1:8765';
const ANKI_APP_PATH = 'C:\\apps\\anki\\anki.exe';
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

runAnki();
contactAnki(() => {
    console.info(
        'INFO: starting to transform the vocabulary list into Anki cards...'
    );
    transformVocabularyToCards(VOCABULARY_FILE_NAME);
});

async function runAnki() {
    if (!(await pingAnki())) {
        cp.execFile(`"${ANKI_APP_PATH}"`, { shell: true, windowsHide: true });
    }
}

async function contactAnki(callback) {
    const isReady = await waitAnki(5);

    if (isReady) {
        callback();
    } else {
        console.error('ERROR: Could not find Anki.');
    }
}

async function waitAnki(attemptsNumber) {
    for (let i = 0; i < attemptsNumber; i++) {
        if ((await pingAnki()) === true) {
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
        console.info('Post request');
        let response = await axios.post(ANKI_URL, {
            action: 'version',
            version: 6,
        });
        if (response.status == 200 && response.data.result == 6) {
            console.info('Recieve 200');
            return true;
        } else {
            console.info('Recieve error');
            return false;
        }
    } catch (error) {
        console.error('Error: ', error);
        return false;
    }
}

function transformVocabularyToCards(fileName) {
    fs.readFile(fileName, 'utf8', async (err, data) => {
        if (err) {
            return console.error(err);
        }
        let terms = data
            .split(/\r?\n|\r|\n/g)
            .map((term) => term.trim())
            .filter((term) => term.length > 0);

        debug(`${terms.length} terms were retrieved from records.`);
        let responses = [];
        for (let term of terms) {
            const termUrl = encodeURI(DICTIONARY_URL + term);
            try {
                console.log(`GET: ${termUrl}`);
                const response = await axios.get(termUrl, { httpsAgent });
                responses.push(response);
            } catch (e) {
                console.error(`ERROR: can not fetch data for term "${term}"`);
                console.error(e);
            }
        }
        buildAnkiCards(responses);
    });
}

async function buildAnkiCards(responses) {
    let notes = [];
    for (const response of responses) {
        if (response.status == 200) {
            const note = await transformToNote(response);
            notes.push(note);
        } else {
            console.error(`ERROR: ${response.statusText}`);
        }
    }

    debug(`payloads length: ${notes.length}`);

    debug('notes: ' + JSON.stringify(notes));

    console.info(
        `INFO: Order to build ${notes.length} note(s) was passed to Anki. Please wait...`
    );

    axios
        .post(ANKI_URL, {
            action: 'multi',
            version: 6,
            params: {
                actions: notes,
            },
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

            for (let i = 0; i < notes.length; i++) {
                let actionResponse = response.data.result[i];
                let term = notes[i].params.note.fields.Term;

                if (actionResponse.error == null) {
                    console.info(`INFO: ${i + 1}. ${term} >> OK`);
                } else {
                    console.error(
                        `ERROR: ${i + 1}. ${term} >> ${actionResponse.error}`
                    );
                }
            }
            notes
                .map((note) => note.params.note.audio[0].path)
                .forEach((filePath) => fs.unlinkSync(filePath));
            console.info(
                'INFO: Finish. Please close the Anki application or press Ctrl+C'
            );
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
    let term = docElement.querySelector(
        '.mw-first-heading .mw-page-title-main'
    )?.text;
    debug(term);
    let transcription = docElement.querySelector('span.ipa')?.text;
    debug(transcription);
    let audioUrl = docElement.querySelector('.audiolink a')?.attributes?.href;
    if (audioUrl.startsWith('//')) {
        audioUrl = PROTOCOL + audioUrl;
    }
    debug(audioUrl);
    let definition = '';
    debug(definition);
    let examples = docElement
        .querySelector('.field-exampl')
        .parentNode.parentNode.querySelectorAll('i')
        .map((element) => element.text)
        .map((example) => example.trim())
        .filter((example) => example.length > 0);
    let example = examples.length === 0 ? term : examples.join(BREAKER);
    debug(example);
    let translatedExample = '';
    debug(translatedExample);
    let iconUrl = docElement.querySelector('figure img')?.attrs?.src;
    if (iconUrl?.startsWith('//')) {
        iconUrl = PROTOCOL + iconUrl;
    }

    return {
        term,
        transcription,
        definition,
        example,
        translatedExample,
        audioUrl,
        iconUrl,
    };
}

async function downloadFile(fileUrl) {
    const fileName = fileUrl
        .slice(fileUrl.lastIndexOf('/') + 1, fileUrl.length)
        .trim();

    try {
        const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
            httpsAgent: httpsAgent,
        });
        response.data.pipe(fs.createWriteStream(fileName));
    } catch {
        return null;
    }
    return __dirname + '\\' + fileName;
}

async function assembleNote(data) {
    const audioPath = await downloadFile(data.audioUrl);
    const audioName =
        audioPath != null
            ? audioPath
                  .slice(audioPath.lastIndexOf('\\') + 1, audioPath.length)
                  .trim()
            : null;
    return {
        action: 'addNote',
        params: {
            note: {
                deckName: 'Słownictwo',
                modelName: 'Basic With Transcription (and reversed card)',
                fields: {
                    Example: data.example,
                    'Translated Example': data.translatedExample,
                    Term: data.term,
                    Transcription: data.transcription,
                    Definition: data.definition,
                },
                options: {
                    allowDuplicate: false,
                    duplicateScope: 'deck',
                    duplicateScopeOptions: {
                        deckName: 'Słownictwo',
                        checkChildren: false,
                        checkAllModels: false,
                    },
                },
                tags: ['Auto-anki'],
                audio: [
                    {
                        path: audioPath,
                        filename: audioName,
                        fields: ['Sound'],
                    },
                ],
                picture: [
                    {
                        url: data.iconUrl,
                        filename: data.iconUrl?.slice(
                            data.iconUrl?.lastIndexOf('/') + 1,
                            data.iconUrl?.length
                        ),
                        fields: ['Icon'],
                    },
                ],
            },
        },
    };
}

function debug(msg) {
    if (!DEBUGGING) {
        return;
    }
    console.debug(msg);
}

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
