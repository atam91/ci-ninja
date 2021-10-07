const express = require('express')
const path = require('path')
const http = require('http')
const app = express()
const bodyParser = require('body-parser')
const Netmask = require('netmask').Netmask
const fs = require('fs')

app.set('port', 61439)
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))

app.post('/', (req, res) => {
  const authorizedIps = [
    '127.0.0.1',
    'localhost'
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
  if (!(inAuthorizedSubnet(ipv4) || authorizedIps.indexOf(ipv4) >= 0)) {
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

  myExec(`./scripts/${payload.repository.name}.sh`, payload.ref.split('/').pop());

  res.writeHead(200)
  res.end()
})

http.createServer(app).listen(app.get('port'), function () {
  console.log('CI Ninja server listening on port ' + app.get('port'))
})

function myExec(line, args) {
  console.log(`Executing task at: ${line} ${args}`)
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
