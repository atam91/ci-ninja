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
    '127.0.0.1',
    'localhost',
    '::1'
  ]
  console.log('IP', req.ip);
  /// console.log('BODY', req.body)

  const payload = req.body

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

  myExec(`./scripts/${payload.repository.name}-${payload.ref.split('/').pop()}.sh`, );

  res.writeHead(200)
  res.end()
})

http.createServer(app).listen(app.get('port'), function () {
  console.log('CI Ninja server listening on port ' + app.get('port'))
})

function myExec(line) {
  console.log(`Executing task at: ${line}`)
  if (!fs.existsSync(line)) {
    console.log(`Could not find script`);
    return
  }
  
  const exec = require('child_process').exec
  const execCallback = (error, stdout, stderr) => {
    if (error !== null) {
      console.log('exec error: ' + error, stderr)
    }

    console.log('STDOUT::', stdout);
    notify(line + "\n" + stdout);
    if (stderr) {
      console.log('!!! STDERR::', stderr);
      if (error !== null) {
        notify(line + '\n⚠⚠⛔⛔⛔⚠⚠ !!! STDERR::\n' + stderr);  /// stderr has some debug info which are non errors
      }
    }
    console.log('^_^');
  }
  exec(line, execCallback)
}

function inAuthorizedSubnet(ip) {
  const authorizedSubnet = [
    '34.74.90.64/28',
    '34.74.226.0/24',
  ].map(function (subnet) {
    return new Netmask(subnet)
  })
  return authorizedSubnet.some(function (subnet) {
    return subnet.contains(ip)
  })
}



function notify(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_NOTIFY_CHANNEL) return;

  axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_NOTIFY_CHANNEL,
        parse_mode: 'Markdown',
        text
      }
  )
      .catch(function (error) {
        console.log('AXIOS ERROR:' + error);
        console.log('RESPONSE DATA:', error.response.data);
      })
}
