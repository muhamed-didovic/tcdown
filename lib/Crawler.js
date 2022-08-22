const fs = require('fs-extra')
const sanitize = require('sanitize-filename')
const path = require('path')
const json2md = require('json2md')
const downOverYoutubeDL = require('./helpers/downOverYoutubeDL')

// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality
const puppeteer = require('puppeteer-extra')
// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())
const findChrome = require('chrome-finder')

const req = require('requestretry')
const j = req.jar()
const request = req.defaults({
    jar         : j,
    retryDelay  : 500,
    fullResponse: true
})

module.exports = class Crawler {

    url = 'https://teachable.com'

    /* constructor () {
        //this._got = got
        this._req = request
    } */

    delay (time) {
        return new Promise(function (resolve) {
            setTimeout(resolve, time)
        })
    }

    /**
     *
     * @param fn
     * @returns {Promise<*>}
     */
    async withBrowser (fn) {
        const browser = await puppeteer.launch({
            headless         : true, //run false for dev
            Ignorehttpserrors: true, // ignore certificate error
            waitUntil        : 'networkidle2',
            defaultViewport  : {
                width : 1920,
                height: 1080
            },
            timeout          : 60e3,
            args             : [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '-- Disable XSS auditor', // close XSS auditor
                '--no-zygote',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '-- allow running secure content', // allow unsafe content
                '--disable-webgl',
                '--disable-popup-blocking',
                //'--proxy-server= http://127.0.0.1:8080 '// configure agent
            ],
            executablePath   : findChrome(),
        })

        try {
            return await fn(browser)
        } finally {
            await browser.close()
        }
    }

    /**
     *
     * @param browser
     * @returns {(function(*): Promise<*|undefined>)|*}
     */
    withPage (browser) {
        return async fn => {
            const page = await browser.newPage()
            try {
                return await fn(page)
            } finally {
                await page.close()
            }
        }
    }

    /**
     *
     * @param page
     * @param url
     * @param opts
     * @returns {Promise<*>}
     */
    async getCourseForDownload (page, url, { all }) {
        const browserPage = await page.evaluate(() => location.href)
        //console.log('url:', browserPage, '++++');
        //check if we are on profile page
        if (!browserPage.includes('/profile')) {
            const series = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.course-list.list a'), a => {
                    return ({
                        url  : a.href,
                        title: a.querySelector('.course-listing-title').innerText
                    })
                })
            })
            // console.log('series', series)
            return [series.find(link => url.includes(link.url))]
        }

        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.schools-list a'), a => {
                return ({
                    href: a.href,
                    txt : a.querySelector('.school-url').innerText
                })
            })
        })

        const link = links.find(link => url.includes(link.txt))
        if (!link) {
            throw 'No link of school found!!!'
        }

        await page.goto(link.href, { waitUntil: 'networkidle0' }) // wait until page load
        await page.waitForSelector('.course-box-image-container', { timeout: 120e3 })

        const series = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.course-list.list a'), a => {
                return ({
                    url  : a.href,
                    title: a.querySelector('.course-listing-title').innerText
                })
            })
        })
        return all ? series : [series.find(link => url.includes(link.url))]
    }

    /**
     *
     * @param page
     * @param opts
     * @returns {Promise<void>}
     */
    async loginAndRedirect (page, opts) {
        const login = opts.login
        await page.goto(login, { waitUntil: 'networkidle0' }) // 'https://sso.teachable.com/secure/1019304/identity/login'
        // await page.goto('https://sso.teachable.com/secure/teachable_accounts/sign_in', { waitUntil: 'networkidle0' }) // wait until page load
        await page.focus('input[type="email"]')
        await page.keyboard.type(opts.email)
        await page.focus('input[type="password"]')
        await page.keyboard.type(opts.password)
        await page.click('input[type="submit"]')
        await this.delay(5e3)

        // await page.waitForSelector('.nav-item-profile.selected')
        // await this.delay(5e3)
    }

    /**
     * @param props
     * @param courses
     * @param dir
     * @param url
     * @returns {bluebird<void>}
     */
    async createMarkdown (courses, url, {
        dir,
        logger
    }) {
        //save resources into md
        courses = courses.filter(c => c?.markdown)
        const md = json2md([
            { h1: 'Links' },
            {
                link: [
                    ...(courses.length > 0 &&
                        [courses.map(c => ({
                            'title' : c.title,
                            'source': c.markdown
                        }))]
                    )
                ]
            }
        ])
        const course = courses[0]
        let downPath = sanitize(course.series)
        const dest = path.join(dir, downPath)
        await fs.ensureDir(dest)
        await fs.writeFile(path.join(dir, downPath, `Resources.md`), md, 'utf8')//-${Date.now()}
        logger.info(`Markdown created ...`)
    }

    /**
     *
     * @param course
     * @param ms
     * @param index
     * @param total
     * @returns {bluebird<{series: string, downPath: string, position: number | string, title: string, url: string}>}
     */
    extractVideos ({
        course,
        ms,
        index,
        total
    }) {
        let series = sanitize(course.series.title)
        let position = course.index + 1
        let title = sanitize(`${String(position).padStart(2, '0')}-${course.title}.mp4`)
        // let downPath = `${course.series.id}-${series}`
        let downPath = series
        // ms.update('info', { text: `Extracting: ${index}/${total} series ${series} - episode ${title}` });

        return {
            series,
            title,
            position,
            downPath,
            vimeoUrl: course.vimeoUrl,
            markdown: course.markdown
        }
    }

    /**
     *
     * @param course
     * @returns <string> url
     * @private
     */
    async getSizeOfVideo (course) {
        const vimeoUrl = course.vimeoUrl

        try {
            const {
                      headers,
                      attempts: a
                  } = await request({
                url         : vimeoUrl, //v,
                json        : true,
                maxAttempts : 50,
                method      : 'HEAD',
                fullResponse: true, // (default) To resolve the promise with the full response or just the body
            })

            return {
                url : vimeoUrl, //v
                size: headers['content-length']
            }
        } catch (err) {
            console.log('ERR::', err)
            /*if (err.message === 'Received invalid status code: 404') {
                return Promise.resolve();
            }*/
            throw err
        }
    };

    /**
     *
     * @param opts
     * @param url
     * @returns {Promise<*>}
     */
    async scrapeCourses (opts, url) {
        const { ms } = opts
        ms.add('info', { text: `Get course: ${url}` })
        return await this.withBrowser(async (browser) => {
            return await this.withPage(browser)(async (page) => {
                await this.loginAndRedirect(page, opts)
                const courses = await this.getCourseForDownload(page, url, opts)
                /* if (!course) {
                    throw 'No course found!!!'
                } */
                // console.log('-------course', course)

                const lessons = await Promise
                    .mapSeries(courses, async course => {
                        ms.update('info', { text: `Checking ${course.url} for lessons` })

                        await page.goto(course.url, { waitUntil: 'networkidle0' }) // wait until page load
                        await page.waitForSelector('h2.section-title', { timeout: 100e3 })

                        const lessons = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('.row'), elem => {
                                return Array.from(elem.querySelectorAll('.section-item a'), e => {
                                    return ({
                                        title: e.innerText.replaceAll('\\W+', '').replace('\\nStart\\n', '').replace(/(\r\n|\n|\r)/gm, '').trim(),
                                        url  : e.href
                                    })
                                })
                            }).flat()
                        })
                        return await Promise
                            .map(lessons, async (lesson, index) => {
                                return await this.withPage(browser)(async (page) => {
                                    // console.log(`scraping: ${index} - ${lesson.url} - ${lesson.title}`);
                                    ms.update('info', { text: `scraping: ${index} - ${lesson.url} - ${lesson.title}` })
                                    await page.goto(lesson.url, { waitUntil: 'networkidle0' })
                                    await page.waitForSelector('.lecture-attachment')
                                    const lessonType = await page.evaluate(() => Array.from(document.body.querySelector('.lecture-attachment').classList, txt => txt))

                                    if (lessonType.includes('lecture-attachment-type-quiz')) {
                                        await this.makeScreenshot(page, course, index, lesson, opts)
                                        return
                                    }
                                    const [vimeoUrl, data] = await Promise.all([
                                        (async () => {
                                            try {
                                                return await this.retry(async () => {//return
                                                    //wait for an iframe
                                                    await page.waitForSelector('iframe[title="Video Player"]', {
                                                        waitUntil: 'networkidle0',
                                                        timeout  : 22e3
                                                    })

                                                    const elementHandle = await page.$('iframe[title="Video Player"]',)
                                                    const frame = await elementHandle.contentFrame()
                                                    await frame.waitForSelector('#__NEXT_DATA__', {
                                                        timeout: 23e3
                                                    })
                                                    const iframeData = await frame.evaluate(() => JSON.parse(Array.from(document.body.querySelectorAll('#__NEXT_DATA__'), txt => txt.textContent)[0]))
                                                    const vimeoUrl = iframeData.props.pageProps.playerData.assets[0].url//urlEncrypted
                                                    return vimeoUrl
                                                }, 6, 1e3, true)

                                            } catch (e) {
                                                console.log(`error with url: ${lesson.url}`, e)
                                                return false
                                            }

                                        })(),
                                        (async () => {
                                            try {
                                                const data = await page.evaluate(() => {
                                                    const title = Array.from(document.querySelectorAll('#lecture_heading'), elem => elem.innerText)[0]
                                                    //const vimeoUrl = Array.from(document.querySelectorAll('.download'), elem => elem.href)[0]
                                                    const markdown = Array.from(document.querySelectorAll('.lecture-text-container'), elem => elem.innerText)[0]?.trim()?.replace('Commit for this lesson: ', '')
                                                    return {
                                                        //vimeoUrl,
                                                        markdown,
                                                        title: title
                                                            .replaceAll('\\W+', '')
                                                            .replace('\\nStart\\n', '')
                                                            .replace(/(\r\n|\n|\r)/gm, '')
                                                            .trim(),
                                                    }
                                                })
                                                return data
                                            } catch (e) {
                                                // console.log('22222', e)
                                                return false
                                            }
                                        })(),
                                    ])

                                    // console.log('v', index, vimeoUrl);
                                    return this.extractVideos({
                                        course: {
                                            index,
                                            ...lesson,
                                            ...data,
                                            vimeoUrl,
                                            series: { ...course }
                                        },
                                        index,
                                        total : lessons.length
                                    })
                                })
                            }, { concurrency: 7 })
                    })
                    .then(c => c.flat())
                    .filter(Boolean)
                    .filter(item => item?.vimeoUrl)
                ms.succeed('info', { text: `Found: ${lessons.length} lessons` })
                await fs.ensureDir(path.resolve(process.cwd(), 'json'))
                await fs.writeFile(`./json/test.json`, JSON.stringify(lessons, null, 2), 'utf8')

                return lessons
            })
        })
    }

    async makeScreenshot (page, course, index, lesson, opts) {
        //create a screenshot
        const $sec = await page.$('div[role="main"]')
        if (!$sec) throw new Error(`Parsing failed!`)
        await this.delay(1e3) //5e3

        let series = sanitize(course.title)
        let position = index + 1
        let title = sanitize(`${String(position).padStart(2, '0')}-${lesson.title}.png`)
        // let downPath = `${course.series.id}-${series}`
        let downPath = series
        const dest = path.join(process.cwd(), opts.dir, downPath)
        fs.ensureDir(dest)
        await $sec.screenshot({
            path          : path.join(dest, title),
            type          : 'png',
            omitBackground: true,
            delay         : '500ms'
        })

        /*await page.screenshot({
            path: path.join(dest, title),
            fullPage: true
        }); */
        await this.delay(1e3)
    }

    /**
     *
     * @param filename
     * @param prefix
     * @param courses
     * @param opts
     * @returns {Promise<void>}
     */
    async d (filename, prefix, courses, opts) {
        const {
                  logger,
                  concurrency,
                  file,
                  filePath,
                  ms
              } = opts

        let cnt = 0
        //logger.info(`Starting download with concurrency: ${concurrency} ...`)
        await Promise.map(courses, async (course, index) => {
            if (course.done) {
                console.log('DONE for:', course.title)
                cnt++
                return
            }
            /*if (!course.vimeoUrl) {
                throw new Error('Vimeo URL is not found')
            }*/

            if (!course?.downPath) {
                console.log('dest:', opts.dir, course.downPath)
                console.log('cccccc', course)
            }
            const dest = path.join(opts.dir, course.downPath)
            fs.ensureDir(dest)

            const details = await this.getSizeOfVideo(course)
            await downOverYoutubeDL(details, path.join(dest, course.title), {
                downFolder: dest,
                index,
                ms
            })

            if (file) {
                courses[index].done = true
                await fs.writeFile(filePath, JSON.stringify(courses, null, 2), 'utf8')
            }
            cnt++
        }, {
            concurrency//: 1
        })
        //ms.stopAll('succeed');
        //logger.succeed(`Downloaded all videos for '${prefix}' api! (total: ${cnt})`)
    }

    /**
     *
     * @param file
     * @param logger
     * @param prefix
     * @param courses
     * @param filename
     * @returns {Promise<void>}
     */
    async writeVideosIntoFile (file, logger, prefix, courses, filename) {
        if (!file) {
            await fs.writeFile(`./json/${filename}`, JSON.stringify(courses, null, 2), 'utf8')
            logger.info(`json file created with lessons ...`)
        }
        logger.succeed(`Downloaded all videos for '${prefix}' api! (total: ${courses.length})`)
        //return courses
    }

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
    async retry (fn, retriesLeft = 5, interval = 1000, exponential = false) {
        try {
            const val = await fn()
            return val
        } catch (error) {
            if (retriesLeft) {
                console.log('.... retrying left (' + retriesLeft + ')')
                console.log('retrying err', error)
                await new Promise(r => setTimeout(r, interval))
                return this.retry(fn, retriesLeft - 1, exponential ? interval * 2 : interval, exponential)
            } else {
                console.log('Max retries reached')
                throw error
                //throw new Error('Max retries reached');
            }
        }
    }
}

