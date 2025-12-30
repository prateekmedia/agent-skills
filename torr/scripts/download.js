#!/usr/bin/env node

/**
 * Robust WebTorrent Downloader with Non-Blocking Timeout
 * Usage: node download.js "magnet:?xt=urn:btih:..." "/output/path" [options]
 *
 * Options:
 *   --timeout <seconds>     Download timeout (default: 10800)
 *   --json                  Output progress as JSON
 *
 * Features:
 * - Progress tracking (every 5%)
 * - Non-blocking timeout (doesn't kill active downloads)
 * - Error handling and recovery
 * - JSON output mode for automation
 * - File size reporting
 * - Connection timeout monitoring
 */

import WebTorrent from 'webtorrent'
import fs from 'fs'
import path from 'path'

// Parse arguments
const args = process.argv.slice(2)
let magnetUri = null
let outputDir = '/tmp/downloads'
let timeoutSecs = 10800
let jsonOutput = false

for (let i = 0; i < args.length; i++) {
  const arg = args[i]

  if (arg === '--timeout' && args[i + 1]) {
    timeoutSecs = parseInt(args[++i])
  } else if (arg === '--json') {
    jsonOutput = true
  } else if (arg.startsWith('magnet:')) {
    magnetUri = arg
  } else if (!arg.startsWith('--') && !magnetUri) {
    magnetUri = arg
  } else if (!arg.startsWith('--') && magnetUri && !outputDir.includes('/')) {
    outputDir = arg
  } else if (!arg.startsWith('--')) {
    outputDir = arg
  }
}

// Logging helpers for JSON mode
function log(message, data = {}) {
  if (jsonOutput) {
    console.log(JSON.stringify({ ...data, message, timestamp: Date.now() }))
  } else {
    console.log(message)
  }
}

function logError(message, data = {}) {
  if (jsonOutput) {
    console.error(JSON.stringify({ ...data, error: message, timestamp: Date.now() }))
  } else {
    console.error(message)
  }
}

// Validate inputs
if (!magnetUri) {
  logError('Usage: node download.js "magnet:..." "/output/path" [options]')
  logError('Example: node download.js "magnet:?xt=urn:btih:..." /tmp/media --timeout 3600')
  logError('Example: node download.js "magnet:?xt=urn:btih:..." /tmp/media --json')
  process.exit(1)
}

// Validate magnet link format
if (!magnetUri.startsWith('magnet:?xt=urn:btih:')) {
  logError('Invalid magnet link format', { received: magnetUri })
  logError('Magnet links should start with: magnet:?xt=urn:btih:')
  process.exit(1)
}

// Create output directory
if (!fs.existsSync(outputDir)) {
  try {
    fs.mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    logError('Failed to create output directory', { error: err.message })
    process.exit(1)
  }
}

const client = new WebTorrent()
let startTime = Date.now()
let lastProgress = 0
let lastActivityTime = Date.now()
let torrentFound = false
let hasStartedDownloading = false
let timeoutWarningShown = false

const CONNECTION_TIMEOUT = 30000 // 30 seconds to find peers
const IDLE_TIMEOUT = 60000 // 60 seconds with no progress

if (!jsonOutput) {
  console.log('=== WebTorrent Downloader ===')
  console.log('Output:', outputDir)
  console.log('Timeout: ' + timeoutSecs + 's')
  console.log('')
} else {
  log('Initializing download', {
    status: 'init',
    outputDir,
    timeoutSecs
  })
}

client.add(magnetUri, { path: outputDir }, function (torrent) {
  torrentFound = true
  lastActivityTime = Date.now()

  if (jsonOutput) {
    log('Torrent found', {
      status: 'found',
      name: torrent.name,
      size: torrent.length,
      files: torrent.files.length,
      peers: torrent.numPeers
    })
  } else {
    console.log('✓ Torrent found:', torrent.name)
    console.log('  Size:', formatBytes(torrent.length))
    console.log('  Files:', torrent.files.length)
    console.log('  Peers:', torrent.numPeers)
    console.log('')
    console.log('Downloading...')
  }
  
  // Progress tracking
  torrent.on('download', function () {
    hasStartedDownloading = true
    lastActivityTime = Date.now()

    const progress = Math.round((torrent.downloaded / torrent.length) * 100)
    const speed = torrent.downloadSpeed
    const eta = torrent.timeRemaining

    if (progress !== lastProgress && progress % 5 === 0) {
      const elapsedSecs = Math.round((Date.now() - startTime) / 1000)

      if (jsonOutput) {
        log('Download progress', {
          status: 'downloading',
          progress,
          downloaded: torrent.downloaded,
          total: torrent.length,
          speed,
          eta,
          elapsed: elapsedSecs,
          peers: torrent.numPeers
        })
      } else {
        console.log(`  ${progress}% | ${formatBytes(speed)}/s | ETA: ${formatTime(eta)} | Elapsed: ${formatTime(elapsedSecs * 1000)}`)
      }

      lastProgress = progress
    }
  })
  
  // Completion handler
  torrent.on('done', function () {
    const elapsedSecs = Math.round((Date.now() - startTime) / 1000)

    const files = []
    let totalSize = 0
    torrent.files.forEach((file, idx) => {
      files.push({
        index: idx,
        name: file.name,
        path: file.path,
        size: file.length
      })
      totalSize += file.length
    })

    if (jsonOutput) {
      log('Download complete', {
        status: 'complete',
        elapsed: elapsedSecs,
        files,
        totalSize,
        location: outputDir
      })
    } else {
      console.log('')
      console.log('✓ Download complete in ' + formatTime(elapsedSecs * 1000))
      console.log('')
      console.log('Files:')

      files.forEach((file, idx) => {
        console.log(`  ${idx + 1}. ${file.path} (${formatBytes(file.size)})`)
      })

      console.log('')
      console.log('Total size: ' + formatBytes(totalSize))
      console.log('Location: ' + outputDir)
    }

    client.destroy()
    process.exit(0)
  })
  
  // Error handler
  torrent.on('error', function (err) {
    logError('Torrent error', { error: err.message })
    client.destroy()
    process.exit(1)
  })
})

// Client-level error handler
client.on('error', function (err) {
  logError('Client error', { error: err.message })
  client.destroy()
  process.exit(1)
})

// Non-blocking timeout monitoring
const timeoutInterval = setInterval(() => {
  const elapsedSecs = Math.round((Date.now() - startTime) / 1000)
  const timeSinceActivity = Date.now() - lastActivityTime
  
  // Timeout: No torrent found within CONNECTION_TIMEOUT
  if (!torrentFound && timeSinceActivity > CONNECTION_TIMEOUT) {
    console.error('✗ Timeout: Could not find/connect to torrent within ' + (CONNECTION_TIMEOUT / 1000) + 's')
    clearInterval(timeoutInterval)
    client.destroy()
    process.exit(1)
  }
  
  // Warning: Long wait time without activity
  if (torrentFound && !hasStartedDownloading && timeSinceActivity > CONNECTION_TIMEOUT && !timeoutWarningShown) {
    console.warn('⚠ Warning: Waiting for peers to connect (' + Math.round(timeSinceActivity / 1000) + 's)')
    timeoutWarningShown = true
  }
  
  // Hard timeout: Exceeded maximum allowed time (but only if download isn't active)
  if (elapsedSecs > timeoutSecs && !hasStartedDownloading) {
    console.error('✗ Timeout: Exceeded ' + timeoutSecs + 's without starting download')
    clearInterval(timeoutInterval)
    client.destroy()
    process.exit(1)
  }
  
  // If download is active, allow it to continue (no hard timeout)
  if (hasStartedDownloading && elapsedSecs > timeoutSecs) {
    if (!timeoutWarningShown) {
      console.warn('⚠ Warning: Download time exceeds ' + timeoutSecs + 's, but continuing...')
      timeoutWarningShown = true
    }
  }
}, 5000) // Check every 5 seconds

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n✓ Cancelling download...')
  clearInterval(timeoutInterval)
  client.destroy()
  process.exit(0)
})

/**
 * Format bytes to human-readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
}

/**
 * Format milliseconds to human-readable time
 */
function formatTime(ms) {
  if (!ms || ms < 0) return 'Unknown'
  const seconds = Math.floor((ms / 1000) % 60)
  const minutes = Math.floor((ms / (1000 * 60)) % 60)
  const hours = Math.floor(ms / (1000 * 60 * 60))
  
  if (hours > 0) {
    return hours + 'h ' + minutes + 'm ' + seconds + 's'
  } else if (minutes > 0) {
    return minutes + 'm ' + seconds + 's'
  } else {
    return seconds + 's'
  }
}
