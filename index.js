const fs = require('fs')
const http = require('http')

require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const Netmask = require('netmask').Netmask
const axios = require('axios').default;

const { TELEGRAM_BOT_TOKEN, TELEGRAM_NOTIFY_CHANNEL } = process.env;

const app = express()
app.set('port', 61439)
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))

app.post('/', (req, res) => {
  const authorizedIps = [
    '127.0.0.1', /// local
    'localhost',
    '::1',
    '207.97.227.253', /// github
    '50.57.128.197',
    '204.232.175.75',
    '108.171.174.178',
  ]
  console.log('IP', req.ip);
  // console.log('BODY', req.body)

  let payload = req.body;
  if (req.body.payload) {
    payload = JSON.parse(req.body.payload)
  }

  if (!payload) {
    console.log('No payload')
    res.writeHead(400)
    res.end()
    return
  }

  const ipv4 = req.ip.replace('::ffff:', '')
  if (!(authorizedIps.includes(ipv4) || inAuthorizedSubnet(ipv4))) {
    console.log('Unauthorized IP:', req.ip, '(', ipv4, ')')
    res.writeHead(403)
    res.end()
    return
  }
  if (!payload.ref) {
    res.writeHead(200)
    res.end()
    return
  }

  execScript(`${payload.repository.name}-${payload.ref.split('/').pop()}`);

  res.writeHead(200)
  res.end()
})

http.createServer(app).listen(app.get('port'), function () {
  console.log('CI Ninja server listening on port ' + app.get('port'));

  tgSendMessage('✅ Ci-ninja has been successfully served!');
})

function inAuthorizedSubnet(ip) {
  const authorizedSubnet = [
    '34.74.90.64/28', /// gitlab
    '34.74.226.0/24',
    '192.30.252.0/22', /// github
    '185.199.108.0/22',
    '140.82.112.0/20',
    '143.55.64.0/20',
  ].map(function (subnet) {
    return new Netmask(subnet)
  })
  return authorizedSubnet.some(function (subnet) {
    return subnet.contains(ip)
  })
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function execScript(scriptname) {
  const line = `./scripts/${scriptname}.sh`;

  console.log(`Executing task at: ${line}`)
  if (!fs.existsSync(line)) {
    console.log(`Could not find script`);
    return
  }

  const startTime = Date.now();

  const exec = require('child_process').exec
  const execCallback = (error, stdout, stderr) => {
    const duration = (Date.now() - startTime) / 1000;

    if (error !== null) {
      console.log('exec error: ' + error, stderr)
    }
    console.log('STDOUT::', stdout);

    const shortReport = error
        ? `💥🙈 *${scriptname}* has been FAILED!!! (${duration}s)`
        : `😁👍 *${scriptname}* has been successfully executed! (${duration}s)`;

    const fullReport = [
      shortReport,
      `\n*STDOUT::*\n${stdout}`,
      error && '⚠️⚠️⛔️⛔️⛔️⚠️⚠️',
      `*STDERR::*\n${stderr}`
    ].filter(v => v).join('\n');

    fs.writeFileSync(`./logs/${scriptname}.log`, fullReport);

    if (error) {
      try {
        tgSendMessage(fullReport);
      } catch(sendError) {
        tgSendMessage(shortReport + '\nCould not send fullReport :((');
      }
    } else {
      tgSendMessage(shortReport);
    }

    console.log('^_^');
  }
  exec(line, execCallback)
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const TG_MESSAGE_LIMIT = 4096;

async function tgSendMessage(text, options = {}) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_NOTIFY_CHANNEL) return;

    const _sendMessage = (text, parse_mode = options.parseMode || 'Markdown') => axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
            chat_id: TELEGRAM_NOTIFY_CHANNEL,
            parse_mode,
            text,
            reply_markup: options.keyboard
                ? {
                    resize_keyboard: true,
                    one_time_keyboard: true,
                    keyboard: options.keyboard,
                }
                : {remove_keyboard: true},
        }
    );
    const sendMessage = async text => {
        try {
            await _sendMessage(text);
        } catch (error) {
            console.log('sendMessage Markdown AXIOS ERROR:' + error);
            console.log('RESPONSE DATA:', error.response.data);

            try {
                await _sendMessage(text, 'none');
            } catch (error2) {
                console.log('sendMessage none_parse AXIOS ERROR:' + error2);
                console.log('RESPONSE DATA:', error2.response.data);

                if (error2.response.data && error2.response.data.description) {
                    await _sendMessage(error2 + '\n' + error2.response.data.description);
                }
            }
        }
    }

  if (text.length > TG_MESSAGE_LIMIT) {
    const chunks = [ '' ];
    text.split('\n').forEach(line => {
      const lastChunk = chunks[chunks.length - 1];
      if ((lastChunk + '\n' + line).length < TG_MESSAGE_LIMIT) {
        chunks[chunks.length - 1] = lastChunk + '\n' + line;
      } else {
        chunks.push(line);
      }
    });

    for (chunk of chunks) {
      await sendMessage(chunk);
    }
  } else {
    await sendMessage(text);
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const CHECK_UPDATES_INTERVAL = 1000;

let currentOffset = 0;
try {
  currentOffset = fs.readFileSync('./data/offset') || 0
} catch (err) {
  if (err.code === 'ENOENT') {
    fs.writeFileSync('./data/offset', '0');
  }
}
const updateCurrentOffset = async (value) => {
  currentOffset = value;
  await fs.promises.writeFile('./data/offset', value.toString());
};

function tgCheckUpdates() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_NOTIFY_CHANNEL) return;

  axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${currentOffset}`)
      .then(async response => {
        const updates = response.data.result;

        await Promise.all(updates.map(async update => {
          if (
              update.message.from.id != TELEGRAM_NOTIFY_CHANNEL
              || update.message.chat.id != TELEGRAM_NOTIFY_CHANNEL
          ) return;

          if (update.message.text === "/show") {
            const files = (await fs.promises.readdir('./logs')).filter(file => !file.startsWith('.'));

            if (files.length) {
              const keyboard = files.map(file => [ `/show ${file}` ]);
              await tgSendMessage('select file', { keyboard });
            } else {
              await tgSendMessage('could not find any log files');
            }
          } else if (update.message.text && update.message.text.startsWith("/show")) {
            const match = update.message.text.match(/\/show\s+(\S+)\s*/);
            if (match) {
              try {
                const file = await fs.promises.readFile(`./logs/${match[1]}`);
                tgSendMessage(file.toString());                                     /// fullReport
              } catch (err) {
                tgSendMessage(err.message);
              }
            }
          }

          await updateCurrentOffset(update.update_id + 1); /// upper for ci-ninja-main *restart* script

          if (update.message.text === "/run") {
            const files = (await fs.promises.readdir('./scripts')).filter(file => !file.startsWith('.'));

            if (files.length) {
              const keyboard = files.map(file => [ `/run ${file}` ]);
              await tgSendMessage('select script', { keyboard });
            } else {
              await tgSendMessage('could not find any script files');
            }
          } else if (update.message.text && update.message.text.startsWith("/run")) {
            const match = update.message.text.match(/\/run\s+(\S+)\s*/);
            if (match) {
              try {
                const scriptfile = match[1];
                await fs.promises.readFile(`./scripts/${scriptfile}`);
                await tgSendMessage(`Running ${scriptfile}`, { parseMode: 'none' });
                execScript(scriptfile.endsWith('.sh') ? scriptfile.replace(/\.sh$/, '') : scriptfile);
              } catch (err) {
                tgSendMessage(err.message);
              }
            }
          }
        }));
      })
      .catch(function (error) {
        console.log('getUpdates AXIOS ERROR:' + error);
        error.response && console.log('RESPONSE DATA:', error.response.data);
      })
      .finally(function() {
        setTimeout(tgCheckUpdates, CHECK_UPDATES_INTERVAL);
      });
}
tgCheckUpdates();
