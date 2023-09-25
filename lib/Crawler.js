const fs = require('fs-extra')
const sanitize = require('sanitize-filename')
const path = require('path')
const json2md = require('json2md')
const downOverYoutubeDL = require('./helpers/downOverYoutubeDL')
const { NodeHtmlMarkdown } = require('node-html-markdown')
const logger = require('./helpers/logger.js')
// var userAgent = require('user-agents')

// const { executablePath } = require('puppeteer')
const findChrome = require('chrome-finder')
const puppeteer = require('puppeteer-extra')
// const StealthPlugin = require('puppeteer-extra-plugin-stealth')
// puppeteer.use(StealthPlugin())
// Use stealth
puppeteer.use(require('puppeteer-extra-plugin-stealth')())
// puppeteer.use(require("puppeteer-extra-plugin-anonymize-ua")());
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder')

const req = require('requestretry')
const FileChecker = require('./helpers/fileChecker')
const downloadCode = require('./helpers/downloadCode')
const j = req.jar()
const request = req.defaults({
    jar         : j,
    retryDelay  : 500,
    fullResponse: true
})

module.exports = class Crawler {

    url = 'https://teachable.com'

    delay (time) {
        return new Promise(function (resolve) {
            setTimeout(resolve, time)
        })
    }

    /**
     *
     * @param fn
     * @param opts
     * @returns {Promise<*>}
     */
    async withBrowser (fn, opts) {
        const browser = await puppeteer.launch({
            headless: opts.headless === 'yes' ? 'new' : false, //run false for dev memo
            // devtools         : true,
            Ignorehttpserrors: true, // ignore certificate error
            // waitUntil        : 'networkidle2',
            defaultViewport: {
                width : 1920,
                height: 1080
            },
            targetFilter   : (target) => !!target.url(),
            // timeout          : 60e3,
            protocolTimeout: 60000e3,
            args           : [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '-- Disable XSS auditor', // close XSS auditor
                '--no-zygote',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--allow running secure content', // allow unsafe content
                '--disable-webgl',
                '--disable-popup-blocking',

                //'--proxy-server= http://127.0.0.1:8080 '// configure agent
            ],
            executablePath : findChrome(),
            // executablePath: executablePath()
            // executablePath: puppeteer
            //     .executablePath()
            //     .match(/google-chrome/) != null
            //     ? puppeteer.executablePath()
            //     : undefined
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
            // await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

            // await page.setUserAgent(userAgent.random().toString())
            // await page.setUserAgent('Mozilla/5.0 (Windows NT 5.1; rv:5.0) Gecko/20100101 Firefox/5.0')
            // await page.setExtraHTTPHeaders({
            //     'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
            //     'upgrade-insecure-requests': '1',
            //     'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            //     'accept-encoding': 'gzip, deflate, br',
            //     'accept-language': 'en-US,en;q=0.9,en;q=0.8'
            // });
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
        // logger.log('url:', browserPage, '++++')
        //check if we are on profile page, basically we are not on school page
        if (!browserPage.includes('/profile')) {
            const series = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.course-list.list a'), a => {
                    return ({
                        url  : a.href,
                        title: a.querySelector('.course-listing-title').innerText
                    })
                })
            })
            logger.log('1series', series)
            return [series.find(link => url.includes(link.url))]
        }

        const schools = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.schools-list a'), a => {
                return ({
                    href: a.href,
                    txt : a.querySelector('.school-url').innerText
                })
            })
        })
        logger.log('schools:', schools)
        /* Links: [
            {
                href: 'https://sso.teachable.com/secure/teachable_accounts/school_redirect/sk_7vvpcbc2',
                txt: 'amigoscode.com'
            },
            {
                href: 'https://sso.teachable.com/secure/teachable_accounts/school_redirect/sk_t22ds596',
                txt: 'members.codewithmosh.com'
            }
        ] */
        const school = schools.find(school => url.includes(school.txt))
        if (!school) {
            throw 'No school of school found!!!'
        }
        logger.log('go to school:', school.href)
        await page.goto(school.href) // , { waitUntil: 'networkidle0' }
        await page.waitForTimeout(5e3)
        //...(trueCondition ? ["dog"] : []),

        /* return await this.retry(async () => {//return
            // await this.screenshotDebug(page, '1-')
            await page.waitForSelector('.course-box-image-container', { timeout: 33e3 }) //120e3
            // await this.screenshotDebug(page, '2-')
            const series = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.course-list.list a'), a => {
                    return ({
                        url  : a.href,
                        title: a.querySelector('.course-listing-title').innerText
                    })
                })
            })
            logger.log('series', [series.find(link => url.includes(link.url))])
            return all ? series : [series.find(link => url.includes(link.url))]
        }, 6, 3e3, true, page) */

        let nextButton = true;
        let series = [];

        while (nextButton) {
            // await this.screenshotDebug(page, '1-')
            await page.waitForSelector('.course-box-image-container', { timeout: 33e3 }) //120e3
            // await this.screenshotDebug(page, '2-')

            const result = await page.$$eval('.course-list.list a', (series) => series.map((link) => {
                // const title = li.querySelector('a h5').innerText;
                // return ({
                //     title,
                //     value: `${li.querySelector('a').href}`,
                //     url  : `${li.querySelector('a').href}`,
                //     course: `Lessons/${title}`,
                //     series: title,
                //     // position: '',
                //     downPath: `Lessons/${title}`
                // })
                return ({
                    url  : link.href,
                    title: link.querySelector('.course-listing-title').innerText
                })
            }))
            series.push(result)
            logger.log('found series:', series.length)
            await page.waitForSelector("nav.pagination", { visible: true });
            nextButton = (await page.$("nav.pagination > span.next > a")) !== null;
            logger.debug('next button available:', nextButton);
            if (nextButton) {
            // await page.waitForSelector("nav.pagination > span.next > a", { visible: true });
                logger.debug('clickkkkk');
                // await Promise.all([
                //     page.click("nav.pagination > span.next > a"),
                //     page.waitForNavigation({ waitUntil: "networkidle2" }),
                // ]);
                page.click("nav.pagination > span.next > a")
            }
            await this.delay(1e3)
        }
        series = series.flat();
        logger.log('courses found:', series.length)
        return all ? series : [series.find(link => url.includes(link.url))]
    }

    async checkForCaptcha (page) {
        const elementExists = await page.$('iframe') !== null//.hcaptcha-box
        logger.log('elementExists', elementExists)

        //frame.evaluate(() => document.documentElement.outerHTML)
        const a = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('iframe'), a => {
                return a.outerHTML
            })
        })
        logger.log('-------------------------------- capthca html:', a)
        if (elementExists) {
            const frame = await page.$('.hcaptcha-box iframe')
            // const html = await frame.evaluate(() => document.documentElement.outerHTML);

            // Get the iframe's content frame
            // const frame = page.frames().find(f => f.id() === 'cf-chl-widget-pz2ir');
            // logger.log('frame found with html:', html)

            // locate the iframe element
            const iframe = await page.$('iframe')

            // switch to the iframe context
            const iframeContent = await iframe.contentFrame()
            const html = await iframeContent.evaluate(() => document.documentElement.outerHTML)
            logger.log('frame found with html:', html)

            // locate the checkbox element inside the iframe
            const checkbox = await iframeContent.$('input[type=checkbox]')
            // const checkbox = await iframeContent.$('.ctp-checkbox-label')//.click();
            // click on the checkbox
            await checkbox.click()

            // Select the element inside the iframe and click it
            // Wait for an element inside the iframe to be present
            // await frame.waitForSelector('.element-inside-iframe');
            // document.querySelectorAll('.ctp-checkbox-label input[type="checkbox"]')

            //------------------------------------
            // await frame.waitForSelector('.ctp-checkbox-label input[type="checkbox"]', { timeout: 29e3 })//
            // await frame.$('.ctp-checkbox-label input[type="checkbox"]').click()
            //------------------------------------

            // const elementExists = await frame.$('input[type="checkbox"]') !== null
            // if (elementExists) {
            //     logger.log('verify frame checkbox', 'input[type="checkbox"]')
            //     const clickLogin = await frame.click('input[type="checkbox"]')
            // }

            /* const frame = await elementHandle.contentFrame()

            // Get the HTML inside the frame
            const html = await frame.evaluate(() => document.documentElement.outerHTML);
            await this.screenshotDebug(page)
            // const iframeData = await frame.evaluate(() => Array.from(document.body.querySelectorAll('html'), txt => txt.innerHTML)[0])
            logger.log('111', html);
            await fs.writeFile(path.join(dest, 'html', sanitize(`${String(0).padStart(2, '0')}-title-test-iframe.html`)), html)
            await this.delay(1e3)

            // await this.checkIfVisibleAndClick(frame, 'input[type="checkbox"]')

            const elementExists = await frame.$('input[type="checkbox"]') !== null
            if (elementExists) {
                logger.log('verify frame checkbox', 'input[type="checkbox"]')
                // await frame.waitForSelector('.pow-button', { timeout: 19e3 })
                await frame.click('input[type="checkbox"]') //ctp-checkbox-label
                // await frame.$('input[type="checkbox"]').click();

                await frame.waitForSelector('input[type="checkbox"]');
                const username = await frame.$('input[type="checkbox"]');
                await username.click();

            } */
            // await this.screenshotDebug(frame)
            // await page.waitForTimeout(5e3)
        }
    }

    /**
     *
     * @param page
     * @param opts
     * @returns {Promise<void>}
     */
    async loginAndRedirect (page, opts) {
        const {
                  login,
                  ms
              } = opts
        const recorder = new PuppeteerScreenRecorder(page)
        await recorder.start(`./simple-${new Date().toISOString()}.mp4`)

        //
        ms.update('info', { text: `checking the signature` })
        // await this.screenshotDebug(page)
        // await page.goto('https://nowsecure.nl/', { waitUntil: 'networkidle0' }) // 'https://sso.teachable.com/secure/1019304/identity/login'
        // // await page.waitForTimeout(55e3)
        // await page.waitForSelector('.hystericalbg', {
        //     timeout: 53e3
        // })

        ms.update('info', { text: `logging -> wait for selector input[type="email"]` })
        // await this.screenshotDebug(page)
        await page.goto(login) //, { waitUntil: 'networkidle0' } // 'https://sso.teachable.com/secure/1019304/identity/login'
        // await this.delay(5e3)

        // await page.waitForTimeout(5000)
        // await page.screenshot({ path: 'stealth.png', fullPage: true })

        // await this.screenshotDebug(page)

        // const dest = path.join(process.cwd(), opts.dir, 'test-course')
        // await this.createHtmlPage(page, dest, 0, 'title-test')

        await this.retry(async () => {//return
            // await this.checkIfVisibleAndClick(page, '.pow-button')

            // logger.log('captha found1')
            // await this.screenshotDebug(page)
            // await page.waitForTimeout(5e3)
            // await this.screenshotDebug(page)

            // const dest = path.join(process.cwd(), opts.dir, 'test-course')
            // await this.createHtmlPage(page, dest, 0, 'title-test-new')
            // logger.log('captha found2')

            // await page.waitForSelector('iframe', {
            //     timeout: 23e3
            // })
            logger.log('before captcha')
            // await this.screenshotDebug(page)

            // await this.checkForCaptcha(page)

            // await this.screenshotDebug(page)

            await page.waitForSelector('input[type="email"]', { timeout: 509e3 })
            ms.update('info', { text: `logging -> selector input[type="email"] found` })
            // await page.goto('https://sso.teachable.com/secure/teachable_accounts/sign_in', { waitUntil: 'networkidle0' }) // wait until page load
            await page.focus('input[type="email"]')
            await page.keyboard.type(opts.email)
            await page.focus('input[type="password"]')
            await page.keyboard.type(opts.password)
            await page.click('input[type="submit"]')
            ms.update('info', { text: `logging -> form submitted` })
            await this.delay(3e3)

        }, 10, 5e3, true, page)

        // await page.waitForSelector('.nav-item-profile.selected')
        // await this.delay(5e3)
        await recorder.stop()
    }

    async checkIfVisibleAndClick (page, selector) {
        // Check if the element exists
        const elementExists = await page.$(selector) !== null
        if (elementExists) {
            logger.log('verify button exists', selector)
            // await page.waitForSelector('.pow-button', { timeout: 19e3 })
            await page.click(selector, {
                visible: true,
            })
        }
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
        if (courses.length === 0) {
            logger.warn('No courses or markdown found for download')
            return
        }
        logger.log('createMarkdown courses', courses)
        const md = json2md([
            { h1: 'Links' },
            {
                link: [
                    ...(courses.length > 0
                            ? [courses.map(c => ({
                                'title' : c.title,
                                'source': c.markdown
                            }))]
                            : []
                    )
                ]
            }
        ])

        // ...(trueCondition ? ["dog"] : []),
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
     * @param position
     * @param total
     * @returns {bluebird<{series: string, downPath: string, position: number | string, title: string, url: string}>}
     */
    extractVideos ({
        course,
        position,
        total
    }) {
        let series = sanitize(course.series.title)
        // let position = course.index + 1
        let title = sanitize(`${String(position).padStart(2, '0')}-${course.title}.mp4`)
        // let downPath = `${course.series.id}-${series}`
        let downPath = series
        // ms.update('info', { text: `Extracting: ${index}/${total} series ${series} - episode ${title}` });

        return {
            series,
            title,
            position,
            downPath,
            url: course.url,
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
            logger.log('ERR::', err)
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
        const {
                  ms,
                  headless,
                  concurrency,
                  all
              } = opts
        ms.add('info', { text: `Get course: ${url}` })
        return await this.withBrowser(async (browser) => {
            return await this.withPage(browser)(async (page) => {

                await this.loginAndRedirect(page, opts)
                // await this.screenshotDebug(page)
                // await this.checkForCaptcha(page)
                // await this.screenshotDebug(page)

                const courses = await this.getCourseForDownload(page, url, opts)
                logger.log('[scrapeCourses] courses found:', courses)
                /* courses [
                    {
                        url: 'https://members.codewithmosh.com/courses/enrolled/2178940',
                        title: 'Mastering Next.js 13 with TypeScript'
                    }
                    ] */
                if (courses.length === 0) {
                    throw 'No course found!!!'
                }
                // logger.log('-------courses', courses)

                const lessons = await Promise
                    .mapSeries(courses, async course => {
                        ms.update('info', { text: `Checking ${course.url} for lessons` })

                        await page.goto(course.url, {
                            //waitUntil: 'networkidle0',
                            timeout: 31e3
                        }) // wait until page load
                        await page.waitForSelector('h2', { timeout: 100e3 })//.section-title

                        let lessons = await Promise.race([
                            (async () => {
                                // check is 'Login' visible
                                try {
                                    await page.waitForSelector('.row', { timeout: 34e3 })
                                    const lessons = await page.evaluate(() => {
                                        return Array.from(document.querySelectorAll('.row .section-item a'), (elem, index) => {
                                            // return Array.from(elem.querySelectorAll('.section-item a'), e => {
                                            return ({
                                                title   : elem.innerText
                                                    .trim()
                                                    .replaceAll('\\W+', '')
                                                    .replace('\\nStart\\n', '')
                                                    .replace(/(\r\n|\n|\r)/gm, '')
                                                    .trim()
                                                    // .replace(/^start\s+\d+\s+-\s+/, '')
                                                    //.replace(/^Start\s\d+\s-\s/, '')
                                                    .replace(/^Start\s+|(\(\d+:\d+\s*\)$)/gi, '')
                                                    // .replace(/\(\d+:\d+\s*\)$/, '')
                                                    .replace(/\s\(\d+:\d+\s\)$/, '')

                                                    .trim(),
                                                url     : elem.href,
                                                position: ++index
                                            })
                                            // })
                                        }).flat()
                                    })
                                    logger.log('[scrapeCourses] found lessons over first option:', lessons.length)
                                    return lessons
                                } catch (e) {
                                    // logger.log('1111', e);
                                    return false
                                }

                            })(),
                            (async () => {
                                //check if "Sign out" is visible
                                try {
                                    await page.waitForSelector('.lectures', { timeout: 35e3 })
                                    const lessons = await page.evaluate(() => {
                                        return Array.from(document.querySelectorAll('.lectures a.text'), (elem, index) => {
                                            return ({
                                                title   : elem
                                                    .querySelector('h3').innerText
                                                    .trim()
                                                    .replaceAll('\\W+', '')
                                                    .replace('\\nStart\\n', '')
                                                    .replace(/(\r\n|\n|\r)/gm, '')
                                                    .trim()
                                                    // .replace(/^start\s+\d+\s+-\s+/, '')
                                                    //.replace(/^Start\s\d+\s-\s/, '')
                                                    .replace(/^Start\s+|(\(\d+:\d+\s*\)$)/gi, '')
                                                    // .replace(/\(\d+:\d+\s*\)$/, '')
                                                    .replace(/\s\(\d+:\d+\s\)$/, '')
                                                    .trim(),
                                                url     : elem.href,
                                                position: ++index

                                            })
                                        })
                                    })
                                    logger.log('[scrapeCourses] found lessons over second option:', lessons.length)
                                    return lessons
                                } catch (e) {
                                    // logger.log('22222', e);
                                    return false
                                }
                            })()
                        ])

                        logger.log('lessons length to download:', lessons.length)//lessons,
                        await fs.ensureDir(path.resolve(__dirname, '../json'))
                        await fs.writeFile(path.resolve(__dirname, `../json/lessons.json`), JSON.stringify(lessons, null, 2), 'utf8')
                        //skip lessons that are downloaded
                        lessons = FileChecker.getDownloadedFilenames(lessons, path.join(opts.dir, sanitize(course.title)))
                        logger.log('remaining lessons length to download:', lessons.length)//lessons,

                        // lessons = lessons.slice(0, concurrency || Infinity).concat(lessons.slice(concurrency || Infinity).reverse())
                        return await Promise
                            .map(lessons, async (lesson) => {//.slice(0, 10)
                                return await this.withPage(browser)(async (page) => {
                                    // logger.info(`[scraping:] ${lesson.position} => ${lesson.title} =>${lesson.url}`)
                                    ms.update('info', { text: `scraping: ${lesson.position} - ${lesson.url} - ${lesson.title}` })

                                    await this.retry(async () => {
                                        await page.goto(lesson.url, {
                                            timeout: 28e3
                                        })

                                        //improve how to get NEXT_DATA
                                        const lessonIcon = await page.evaluate(() => Array.from(document.querySelectorAll('#lecture_heading > svg > use'), a => a.getAttribute('xlink:href'))[0])
                                        if (lessonIcon === '#icon__Video') {
                                            logger.info('video lesson:', lessonIcon, lesson.url, 'title:', lesson.title)
                                            const elementHandle = await page.$('iframe[title="Video Player"]')
                                            const frame = await elementHandle.contentFrame()
                                            await frame.waitForSelector('#__NEXT_DATA__', {
                                                timeout: 15e3
                                            })
                                        }

                                    }, 6, 1e3, true, page)

                                    await page.waitForSelector('.lecture-attachment')
                                    const lessonType = await page.evaluate(() => Array.from(document.body.querySelector('.lecture-attachment').classList, txt => txt))
                                    if (lessonType.includes('lecture-attachment-type-quiz')) {
                                        // await this.makeScreenshot(page, course, lesson.position, lesson, opts)
                                        return
                                    }

                                    opts.screenshot === 'yes' && await this.makeScreenshot(browser, page, course, lesson.position, lesson, opts)
                                    const lessonIcon = await page.evaluate(() => Array.from(document.querySelectorAll('#lecture_heading > svg > use'), a => a.getAttribute('xlink:href'))[0])
                                    const [vimeoUrl, data] = await Promise.all([//
                                        (async () => {
                                            try {

                                                // document.querySelector('#lecture_heading > svg > use').getAttribute('xlink:href');
                                                //'#icon__Video'
                                                //'#icon__Subject'

                                                if (lessonIcon !== '#icon__Video') {
                                                    logger.warn('not video lesson:', lessonIcon, lesson.url, 'title:', lesson.title)
                                                    FileChecker.writeResourceUrlWithOutSize(path.join(opts.dir, sanitize(course.title)), lesson.url)
                                                    return
                                                }
                                                logger.info('video lesson:', lessonIcon, lesson.url)
                                                return await this.retry(async () => {

                                                    // if (lessonIcon !== '#icon__Video') {
                                                    //     logger.warn('2not video lesson:', lessonIcon, lesson.url)
                                                    //     return
                                                    // }
                                                    //wait for an iframe
                                                    await page.waitForSelector('iframe[title="Video Player"]', {
                                                        //waitUntil: 'networkidle0',
                                                        timeout: 32e3
                                                    })

                                                    const elementHandle = await page.$('iframe[title="Video Player"]')
                                                    const frame = await elementHandle.contentFrame()
                                                    await frame.waitForSelector('#__NEXT_DATA__', {
                                                        timeout: 29e3
                                                    })
                                                    const iframeData = await frame.evaluate(() => JSON.parse(Array.from(document.body.querySelectorAll('#__NEXT_DATA__'), txt => txt.textContent)[0]))
                                                    if (!iframeData?.props?.pageProps?.applicationData?.mediaAssets[0]?.url) {
                                                        logger.error(`[scraping:] no iframe found$ ${lesson.position} => ${lesson.title} - ${lesson.url} `, iframeData.props.pageProps.applicationData)
                                                    } else {
                                                        logger.log(`[scraping:] ${lesson.position} => ${lesson.title} - ${lesson.url} - ${iframeData.props.pageProps.applicationData.mediaAssets[0].url}`)
                                                    }

                                                    const vimeoUrl = iframeData.props.pageProps.applicationData.mediaAssets[0].url//urlEncrypted
                                                    return vimeoUrl
                                                }, 6, 1e3, false, page)

                                            } catch (e) {
                                                logger.log(`error with url: ${lesson.url}`, e)
                                                return false
                                            }

                                        })(),

                                        (async () => {
                                            try {
                                                if (lessonIcon === '#icon__Video') {
                                                    return;
                                                }
                                                await page.waitForSelector('a.download', {
                                                    //waitUntil: 'networkidle0',
                                                    timeout: 21e3
                                                })

                                                let downloadURLs = await page.evaluate(() => Array.from(document.body.querySelectorAll('a.download'), a => (
                                                    {
                                                        url: a.href,
                                                        name: a.getAttribute('data-x-origin-download-name')
                                                    }
                                                )))
                                                logger.info('downloadURLs:', downloadURLs);
                                                /* const downloadURL = await page.evaluate(() => {
                                                    const requests = Array.from(performance.getEntriesByType('resource'));
                                                    const zipRequest = requests.find(request => request.name.endsWith('.zip'));
                                                    return zipRequest ? zipRequest.name : null;
                                                }); */
                                                const dest =   path.join(opts.dir, sanitize(course.title))
                                                await Promise.map(downloadURLs ?? [], async (resource) => {
                                                    // const isDownloaded = FileChecker.isCompletelyDownloadedWithOutSize(dest, `https://codecourse.com/files/${ c.id }/download`)
                                                    // logger.warn('[download] isDownloaded:', isDownloaded !== false, dest)
                                                    // if (isDownloaded) {
                                                    //     return
                                                    // }
                                                    logger.info(`[download] Resource found from resources.data: ${lesson.title} dest: ${dest}`, resource)
                                                    if (!resource?.name) {
                                                        return;
                                                    }
                                                    await downloadCode({
                                                        url: resource.url,
                                                        downFolder: dest,
                                                        dest: path.join(dest, `${ resource.name }`)//.zip
                                                    })
                                                    logger.info(`[download] Resource downloaded from resources.data: ${lesson.title} dest: ${dest}`)
                                                })

                                            } catch (e) {
                                                // logger.log('22222', e)
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
                                                // logger.log('22222', e)
                                                return false
                                            }
                                        })()
                                    ])

                                    // logger.log('v', index, vimeoUrl);
                                    const resource = this.extractVideos({
                                        course  : {
                                            ...lesson,
                                            ...data,
                                            vimeoUrl,
                                            series: { ...course }
                                        },
                                        position: lesson.position,
                                        total   : lessons.length
                                    })
                                    // logger.log('for download:', resource)
                                    const prefix = all ? 'all-courses' : 'single-course'
                                    const filename = `${prefix}-${new Date().toISOString()}.json`
                                    if (resource?.vimeoUrl) {
                                        logger.log(`Found vimeourl and starting download: ${lesson.title} ${resource?.vimeoUrl}`)
                                        ms.update('info', { text: `Found vimeourl and starting download: ${lesson.title} ${resource?.vimeoUrl}` })
                                        await this.d(filename, prefix, [resource], { ms, ...opts })
                                    }

                                    return resource
                                })
                            }, { concurrency: 5 })//: 3
                    })
                    .then(c => c.flat())
                    .filter(Boolean)
                    .filter(item => item?.vimeoUrl)
                ms.succeed('info', { text: `Found: ${lessons.length} lessons` })
                await fs.ensureDir(path.resolve(__dirname, '../json'))
                await fs.writeFile(path.resolve(__dirname, `../json/test.json`), JSON.stringify(lessons, null, 2), 'utf8')

                return lessons
            })
        }, opts)
    }

    async screenshotDebug (page, title = '') {
        await fs.ensureDir(path.resolve(__dirname, '../debug'))
        path.resolve(__dirname, `../debug/${title}${new Date().toISOString()}.png`)
        await page.screenshot({
            path    : path.resolve(__dirname, `../debug/${title}${new Date().toISOString()}.png`),
            fullPage: true
        })
    }

    /**
     *
     * @param filename
     * @param prefix
     * @param resources
     * @param opts
     * @returns {Promise<void>}
     */
    async d (filename, prefix, resources, opts) {
        const {
                  logger,
                  concurrency,
                  file,
                  filePath,
                  ms
              } = opts

        let cnt = 0
        await Promise.map(resources, async (resource) => {
            logger.info(`[d] Starting download with concurrency: ${concurrency} resource: ${resource.title}...`)
            if (resource.done) {
                logger.log('[d] DONE for:', resource.title)
                cnt++
                return
            }
            /*if (!resource.vimeoUrl) {
                throw new Error('Vimeo URL is not found')
            }*/

            if (!resource?.downPath) {
                logger.log('[d] dest:', opts.dir, resource.downPath)
                logger.log('[d] details:', resource)
            }
            const dest = path.join(opts.dir, resource.downPath)
            fs.ensureDir(dest)

            const details = await this.getSizeOfVideo(resource)
            await downOverYoutubeDL(details, path.join(dest, resource.title), {
                downFolder: dest,
                index     : resource.position,
                resourceUrl: resource.url,
                ms
            })

            if (file) {
                resources[resource.position].done = true
                await fs.writeFile(filePath, JSON.stringify(resources, null, 2), 'utf8')
            }
            cnt++
        }
        /* , {
            concurrency: 2
        } */
        )
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
            await fs.writeFile(path.resolve(__dirname, `../json/${filename}`), JSON.stringify(courses, null, 2), 'utf8')
            logger.debug(`json file created with lessons ...`)
        }
        logger.info(`Downloaded all videos for '${prefix}' api! (total: ${courses.length})`)
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
     * @param page
     * @return {Promise<*>}
     */
    async retry (fn, retriesLeft = 5, interval = 1000, exponential = false, page = null) {
        try {
            const val = await fn()
            return val
        } catch (error) {
            if (retriesLeft) {
                logger.warn('.... retrying left (' + retriesLeft + ')')
                logger.warn('retrying err', error)
                logger.warn('error mesage', error.message) //frame got detached
                if (page) {
                    const browserPage = await page?.evaluate(() => location.href)
                    logger.error('[retry] retrying err on url', browserPage)
                    await fs.ensureDir(path.resolve(process.cwd(), 'errors'))
                    await page?.screenshot({
                        path    : path.resolve(process.cwd(), `errors/${new Date().toISOString()} - ${browserPage.split('/').pop()}.png`),
                        fullPage: true
                    })
                }
                await new Promise(r => setTimeout(r, interval))
                return this.retry(fn, retriesLeft - 1, exponential ? interval * 2 : interval, exponential, page)
            } else {
                logger.error('Max retries reached')
                throw error
                //throw new Error('Max retries reached');
            }
        }
    }

    async makeScreenshot (browser, page, course, position, lesson, opts) {
        //create a screenshot
        const $sec = await page.$('body')//div[role="main"]'
        if (!$sec) throw new Error(`Parsing failed!`)
        await this.delay(1e3) //5e3

        let series = sanitize(course.title)
        // let position = index + 1
        let title = lesson.title
        // let title = sanitize(`${String(position).padStart(2, '0')}-${lesson.title}.png`)
        // let downPath = `${course.series.id}-${series}`
        const dest = path.join(process.cwd(), opts.dir, series)
        await fs.ensureDir(path.join(dest, 'screenshot'))
        await $sec.screenshot({
            path          : path.join(dest, 'screenshot', sanitize(`${String(position).padStart(2, '0')}-${lesson.title}.png`)),
            type          : 'png',
            omitBackground: true,
            delay         : '500ms'
        })

        await this.delay(1e3)

        opts.html === 'yes' && await this.createHtmlPage(page, dest, position, title)
        await this.createMarkdownFromHtml(page, course, position, title, opts)
        await this.createPdf(browser, page, dest, position, title)
        // await this.createFullPageScreenshot(page, dest, position, title);
        await this.delay(1e3)
    }

    async isHeadlessMode (browser) {
        // const u = await page.evaluate('navigator.userAgent');
        const ua = await browser.userAgent()
        // logger.log('1111UA:', ua, ua.toLowerCase().includes('headlesschrome'))
        return ua.toLowerCase().includes('headlesschrome')
    }

    async createPdf (browser, page, dest, position, title) {
        /* if (!await this.isHeadlessMode(browser)) {
            logger.log('headless mode is set on!!!')
            return
        } */
        await fs.ensureDir(path.join(dest, 'pdf'))
        await page.pdf({
            path           : path.join(dest, 'pdf', sanitize(`${String(position).padStart(2, '0')}-${title}.pdf`)),
            printBackground: true,
            format         : 'Letter'
        })
    }

    async createHtmlPage (page, dest, position, title) {
        await fs.ensureDir(path.join(dest, 'html'))
        //save html of a page
        const html = await page.content()
        await fs.writeFile(path.join(dest, 'html', sanitize(`${String(position).padStart(2, '0')}-${title}.html`)), html)
        await this.delay(1e3)
    }

    async createFullPageScreenshot (page, dest, position, title) {
        await fs.ensureDir(dest)
        await page.screenshot({
            path    : path.join(dest, sanitize(`${String(position).padStart(2, '0')}-${title}-full.png`)),
            fullPage: true
        })
    }

    async createMarkdownFromHtml (page, course, position, title, opts) {
        const nhm = new NodeHtmlMarkdown()
        // let position = index + 1
        let markdown = await page.evaluate(() => Array.from(document.body.querySelectorAll('div[role="main"]'), txt => txt.outerHTML)[0])
        if (!markdown) {
            logger.log('-----------------nema markdown', title)
            await this.createFullPageScreenshot(page, path.join(opts.dir, sanitize(course.title), 'error'), 0, title)
            throw new Error(`No Markdown found - ${title}\``)
        }
        await fs.ensureDir(path.join(opts.dir, sanitize(course.title), 'markdown'))
        await fs.writeFile(path.join(opts.dir, sanitize(course.title), 'markdown', sanitize(`${String(position).padStart(2, '0')}-${title}.md`)), nhm.translate(markdown), 'utf8')
        await this.delay(1e3)
    }
}

