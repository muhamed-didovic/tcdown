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
            executablePath: findChrome(),
            headless      : false
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
        await page.waitForSelector('.course-box-image-container', { timeout: 100e3 })

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
        await page.goto('https://sso.teachable.com/secure/teachable_accounts/sign_in', { waitUntil: 'networkidle0' }) // wait until page load
        await page.focus('input[id="teachable_account_email"]')
        await page.keyboard.type(opts.email)
        await page.focus('input[id="teachable_account_password"]')
        await page.keyboard.type(opts.password)
        await page.click('input[name="commit"]')
        await this.delay(5e3)
        await page.waitForSelector('.nav-item-profile.selected')
        await this.delay(5e3)
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
                                    ms.update('info', { text: `scraping: ${lesson.url}` })
                                    await page.goto(lesson.url, {
                                        waitUntil: 'networkidle0',
                                        timeout: 60e3
                                    })
                                    const data = await page.evaluate(() => {
                                        const title = Array.from(document.querySelectorAll('#lecture_heading'), elem => elem.innerText)[0]
                                        const vimeoUrl = Array.from(document.querySelectorAll('.download'), elem => elem.href)[0]
                                        const markdown = Array.from(document.querySelectorAll('.lecture-text-container'), elem => elem.innerText)[0]?.trim()?.replace('Commit for this lesson: ', '')
                                        return {
                                            vimeoUrl,
                                            markdown,
                                            title: title
                                                .replaceAll('\\W+', '')
                                                .replace('\\nStart\\n', '')
                                                .replace(/(\r\n|\n|\r)/gm, '')
                                                .trim(),
                                        }
                                    })

                                    return this.extractVideos({
                                        course: {
                                            index,
                                            ...lesson,
                                            ...data,
                                            series: { ...course }
                                        },
                                        index,
                                        total : lessons.length
                                    })
                                })
                            }, { concurrency: 3 })
                    })
                    .then(c => c.flat())
                ms.succeed('info', { text: `Found: ${lessons.length} lessons` })
                await fs.ensureDir(path.resolve(process.cwd(), 'json'))
                await fs.writeFile(`./json/test.json`, JSON.stringify(lessons, null, 2), 'utf8')

                return lessons
            })
        })
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
}

