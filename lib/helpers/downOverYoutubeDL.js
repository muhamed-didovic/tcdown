// @ts-check
const fileSize = require('./fileSize')
const retrier = require('./retrier')
const { formatBytes, writeWaitingInfoDL } = require('./writeWaitingInfo');
const FileChecker = require('./fileChecker');
const path = require('path')
const ytdl = require('ytdl-run')
const fs = require('fs-extra')
const Promise = require('bluebird')
// const youtubedl = require("youtube-dl-wrap")
const YTDlpWrap = require('yt-dlp-wrap').default;
const colors = require('colors');
const logger = require("./logger.js");
const pRetry = require('@byungi/p-retry').pRetry
const pDelay = require('@byungi/p-delay').pDelay

const getFilesizeInBytes = filename => {
    return fs.existsSync(filename) ? fs.statSync(filename)["size"] : 0;
};

/**
 * Retries the given function until it succeeds given a number of retries and an interval between them. They are set
 * by default to retry 5 times with 1sec in between. There's also a flag to make the cooldown time exponential
 * @author Daniel Iñigo <danielinigobanos@gmail.com>
 * @param {Function} fn - Returns a promise
 * @param {Number} retriesLeft - Number of retries. If -1 will keep retrying
 * @param {Number} interval - Millis between retries. If exponential set to true will be doubled each retry
 * @param {Boolean} exponential - Flag for exponential back-off mode
 * @return {Promise<*>}
 */
async function retry(fn, retriesLeft = 5, interval = 1000, exponential = false) {
    try {
        const val = await fn();
        return val;
    } catch (error) {
        if (retriesLeft) {
            logger.warn('.... p-cluster retrying left (' + retriesLeft + ')');
            logger.warn('retrying err', error);
            await new Promise(r => setTimeout(r, interval));
            return retry(fn, retriesLeft - 1, exponential ? interval*2 : interval, exponential);
        } else {
            logger.error('Max retries reached');
            throw error
            //throw new Error('Max retries reached');
        }
    }
}

const download = (url, dest, {
    localSizeInBytes,
    remoteSizeInBytes,
    downFolder,
    index = 0,
    ms
}) => {
    return new Promise(async (resolve, reject) => {
        const videoLogger = createLogger(downFolder);
        // await fs.remove(dest) // not supports overwrite..
        ms.update(dest, {
            text : `to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`,
            color: 'blue'
        });
        // console.log(`to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`)

        return await retry(async () => {//return
            const youtubeDlWrap = new youtubedl()
            let youtubeDlEventEmitter = youtubeDlWrap
                // .exec([url, "-o", path.toNamespacedPath(dest)])
                .exec([
                    url,
                    "--write-subs",
                    "--write-auto-sub",
                    // '--referer', 'https://example.com/',
                    "-o", path.resolve(dest),
                    '--socket-timeout', '5'
                ])
                .on("progress", (progress) => {
                    ms.update(dest, { text: `${index}. Downloading: ${progress.percent}% of ${progress.totalSize} at ${progress.currentSpeed} in ${progress.eta} | ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}` })
                })
                // .on("youtubeDlEvent", (eventType, eventData) => console.log(eventType, eventData))
                .on("error", (error) => {
                    // ms.remove(dest, { text: error })
                    console.log('error--', error)
                    ms.remove(dest);
                    /*fs.unlink(dest, (err) => {
                        reject(error);
                    });*/
                    reject(error);

                })
                .on("close", () => {
                    ms.succeed(dest, { text: `${index}. End download ytdl: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}` })//.split('/').pop()
                    // ms.remove(dest);
                    // console.log(`${index}. End download ytdl: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}`.green);
                    videoLogger.write(`${dest} Size:${getFilesizeInBytes(dest)}\n`);
                    resolve()
                })

        }, 6, 2e3, true)

    });
};

/**
 *
 * @param url
 * @param dest
 * @param localSizeInBytes
 * @param remoteSizeInBytes
 * @param downFolder
 * @param index
 * @param logger
 * @param ms
 * @returns {Promise}
 */
const newDownload = (url, dest, localSizeInBytes, remoteSizeInBytes, downFolder, index, logger, ms) => {
    return new Promise(async (resolve, reject) => {
        // console.log('file', file);
        // const { skipVimeoDownload, vimeoUrl } = file;
        // logger.debug('[DOWNLOADING:]', url, 'localSizeInBytes:', localSizeInBytes, 'remoteSizeInBytes:', remoteSizeInBytes);
        // const videoLogger = createLogger(downFolder);
        // await fs.remove(dest) // not supports overwrite..
        //let name = dest + index;
        ms.update(dest, {
            text : `to be processed by yt-dlp... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`,
            color: 'blue'
        });
        // console.log(`to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes} - ${url}`)
        // return Promise.resolve()
        // https://player.vimeo.com/texttrack/17477597.vtt?token=6321c441_0x383403d52f6fdaa619c98c88b50efbb63b6d0096

        // yt-dlp -v --retries 'infinite' --fragment-retries 'infinite' --referer "https://vuemastery.com/" "https://player.vimeo.com/video/429439600?h=73c87a798c&autoplay=1&app_id=122963"

        const ytDlpWrap = new YTDlpWrap();
        let ytDlpEventEmitter = ytDlpWrap
            .exec([
                url,

                // "--write-subs",
                // "--write-auto-sub",

                // '--referer', 'https://vuemastery.com/',
                "-o", path.resolve(dest),


                '-vU',
                '--add-header', "Accept:*/*",
                '--cookies-from-browser', 'chrome',
                "--user-agent", "facebookexternalhit/1.1",
                // '--retries', 'infinite',
                // '--fragment-retries', 'infinite',
                // '--socket-timeout', '5',

                // '--retries', 'infinite',
                // '--retry-sleep', 'exp=1:3600',
                // '--socket-timeout', '3600'

                // "-o", path.toNamespacedPath(dest),
                // '--socket-timeout', '5',
                //...(skipVimeoDownload ? ['--skip-download'] : []),
            ])
            .on('ytDlpEvent', (eventType, eventData) =>
                // console.log(eventType, eventData)
                //65.0% of   24.60MiB at    6.14MiB/s ETA 00:01
                ms.update(dest, { text: `${eventType}: ${eventData} | ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}` })
            )
            // .on("youtubeDlEvent", (eventType, eventData) => console.log(eventType, eventData))
            .on("error", (error) => {
                // ms.remove(dest, { text: error })
                if (!error.message.includes('Unable to extract info section')) {
                    logger.error('URL:', url, 'dest:', dest, 'error--', error);
                }
                console.log('------> tu smo');
                /*fs.unlink(dest, (err) => {
                    reject(error);
                });*/
                //return Promise.reject(error)
                //if (!error.message.includes('Unable to download video subtitles')) {
                reject(error);
                //}

            })
            .on("close", () => {
                //ms.succeed(dest, { text: `${index}. End download yt-dlp: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}` })//.split('/').pop()
                // ms.remove(dest);
                console.log(`${index}. End download yt-dlp: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}`);
                // videoLogger.write(`${dest} Size:${getFilesizeInBytes(dest)}\n`);
                FileChecker.writeWithOutSize(downFolder, dest)
                // videoLogger.write(`${dest} Size:${getFilesizeInBytes(dest)}\n`);
                // return Promise.resolve()
                resolve()
            })
    })
}

/**
 * @param file
 * @param {import("fs").PathLike} dest
 * @param downFolder
 * @param index
 * @param ms
 */
module.exports = async (file, dest, { downFolder, index, ms } = {}) => {
    const url = file.url;
    let remoteFileSize = file.size;
    logger.info(`[downOverYoutubeDL] Checking if video is downloaded: ${dest}`);//.split('/').pop()
    ms.add(dest, { text: `Checking if video is downloaded: ${dest.split('/').pop()}` });
    // console.log(`Checking if video is downloaded: ${dest.split('/').pop()}`);

    let isDownloaded = false;
    let localSize = getFilesizeInBytes(`${dest}`)
    let localSizeInBytes = formatBytes(getFilesizeInBytes(`${dest}`))
    isDownloaded = FileChecker.isCompletelyDownloadedWithOutSize(downFolder, dest)
    logger.debug('[downOverYoutubeDL] isDownloaded>>>>', isDownloaded);
    if (remoteFileSize === localSize || isDownloaded) {
        ms.succeed(dest, { text: `${index}. Video already downloaded: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)}` });
        //ms.remove(dest);
        logger.debug(`[downOverYoutubeDL] ${index}. Video already downloaded: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)}`.blue);
        return;
    } else {
        ms.update(dest, { text: `${index} Start download video: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)} ` });
        logger.debug(`[downOverYoutubeDL] ${index} Start ytdl download: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)} `);
        // console.log(`${index} Start ytdl download: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)} `);
        // return await download(url, dest, {
        //     localSizeInBytes,
        //     remoteSizeInBytes: formatBytes(remoteFileSize),
        //     downFolder,
        //     index,
        //     ms
        // });
        // await retrier(async () => await newDownload(url, dest, {
        //         localSizeInBytes,
        //         remoteSizeInBytes: formatBytes(0),
        //         downFolder,
        //         index,
        //         logger,
        //         ms
        //     })
        // )
        await newDownload(
            url,
            dest,
            localSizeInBytes,
            formatBytes(remoteFileSize), //remoteSizeInBytes: formatBytes(remoteFileSize),
            downFolder,
            index,
            logger,
            ms
        )
        logger.info('[downOverYoutubeDL] remove spinner:', dest)
        ms.remove(dest)
    }
}

