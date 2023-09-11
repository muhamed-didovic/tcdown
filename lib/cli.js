#!/usr/bin/env node
const meow = require('meow')
const prompts = require('prompts')
const createLogger = require('./helpers/createLogger')
const { scrape } = require('.')
const path = require('path')
const fs = require('fs-extra')
const isValidPath = require('is-valid-path')
// const Crawler = require('./Crawler')
// const Fuse = require('fuse.js')

const cli = meow(`
Usage
    $ tcdown [CourseUrl]

Options
    --all, -a           Get all courses from particular school or provider.
    --login, -l         Your login url with login form.
    --email, -e         Your email.
    --password, -p      Your password.
    --directory, -d     Directory to save.
    --file, -f          Location of the file where are the courses
    --headless, -h      Enable headless (values: 'yes' or 'no'), default value is 'yes'
    --html, -t          Enable html download (values: 'yes' or 'no'), default value is 'yes'
    --screenshot, -s    Enable screenshot (values: 'yes' or 'no'), default value is 'yes'
    --concurrency, -c

Examples
    $ tcdown
    $ tcdown -a
    $ tcdown [url] [-l url...] [-e user@gmail.com] [-p password] [-d dirname] [-t yes/no] [-s yes/no] [-c number] [-f path-to-file]
`, {
    flags: {
        help       : { alias: 'h' },
        version    : { alias: 'v' },
        all        : {
            type : 'boolean',
            alias: 'a'
        },
        login      : {
            type : 'string',
            alias: 'l'
        },
        email      : {
            type : 'string',
            alias: 'e'
        },
        password   : {
            type : 'string',
            alias: 'p'
        },
        directory  : {
            type : 'string',
            alias: 'd'
        },
        concurrency: {
            type   : 'number',
            alias  : 'c',
            default: 10
        },
        file       : {
            type : 'boolean',
            alias: 'f'
        },
        headless  : {
            type: 'string',
            alias: 'h',
            default: 'yes'
        },
        html  : {
            type: 'string',
            alias: 't',
            default: 'yes'
        },
        screenshot  : {
            type: 'string',
            alias: 's',
            default: 'yes'
        }
    }
})

const logger = createLogger()
// const errorHandler = err => (console.log('\u001B[1K'), logger.fail(String(err)), process.exit(1))
// const errorHandler = err => (console.error(err), logger.fail(String(err)), process.exit(1))
const errorHandler = err => (console.error('MAIN errorr:', err), process.exit(1))//logger.fail(`HERE IS THE ERROR in string: ${String(err}`))
const askOrExit = question => prompts({ name: 'value', ...question }, { onCancel: () => process.exit(0) }).then(r => r.value)
const folderContents = async (folder) => {
    const files = await fs.readdir(folder)
    // console.log('files', files);
    if (!files.length) {
        return console.log('No files found');
    } else {
        console.log(`found some files: ${files.length} in folder: ${folder}`);
    }

    return files
        //.filter(file => file.includes('.png'))
        .map(file => {
            return ({
                title: file,
                value: path.join(folder, file)
            })
        });

}

(async () => {
    const {
              flags,
              input
          } = cli

    if (input.length === 0) {
        input.push(await askOrExit({
            type   : 'text',
            message: 'Enter url for download.',
            // initial : 'https://laraveldaily.teachable.com/courses/enrolled/1690714',
            initial : 'https://the-designership.teachable.com/courses/enrolled/1487217', //figma
            validate: value => value.includes('teachable.com') ? true : 'Url is not valid'
        }))
    }

    const login = flags.login || await askOrExit({
        type    : 'text',
        message : 'Enter login page or url',
        // initial: 'https://sso.teachable.com/secure/teachable_accounts/sign_in',
        initial: 'https://sso.teachable.com/secure/1019304/identity/login', // figma
        validate: value => value.includes('teachable.com') ? true : 'Url is not valid'
    })

    const all = flags.all || await askOrExit({
        type   : 'confirm',
        message: 'Do you want all courses from this school or just single course?',
        initial: false
    })

    const file = flags.file || await askOrExit({
        type   : 'confirm',
        message: 'Do you want download from a file',
        initial: false
    })

    const filePath = flags.file || await askOrExit({
        type    : file ? 'autocomplete' : null,
        message : `Enter a file path eg: ${path.resolve(process.cwd(), 'json/*.json')} `,
        choices : await folderContents(path.resolve(process.cwd(), 'json')),
        validate: isValidPath
    })

    const email = flags.email || await askOrExit({
        type    : 'text',
        message : 'Enter email',
        validate: value => value.length < 5 ? 'Sorry, enter correct email' : true
    })
    const password = flags.password || await askOrExit({
        type    : 'text',
        message : 'Enter password',
        validate: value => value.length < 5 ? 'Sorry, password must be longer' : true
    })
    const dir = flags.directory || path.resolve(await askOrExit({
        type    : 'text',
        message : `Enter a directory to save (eg: ${path.resolve(process.cwd())})`,
        initial : path.resolve(process.cwd(), 'videos/'),
        validate: isValidPath
    }))

    const concurrency = flags.concurrency || await askOrExit({
        type   : 'number',
        message: 'Enter concurrency',
        initial: 10
    })

    const headless = (['yes', 'no', 'y', 'n'].includes(flags.headless)
        ? flags.headless
        : await askOrExit({
            type   : 'select',
            message: 'Enable headless?',
            choices: [
                {
                    title: 'Yes',
                    value: 'yes'
                },
                {
                    title: 'No',
                    value: 'no'
                }
            ],
            initial: 1
        }))

    const html = (['yes', 'no', 'y', 'n'].includes(flags.html)
        ? flags.html
        : await askOrExit({
            type   : 'select',
            message: 'Include html as well?',
            choices: [
                {
                    title: 'Yes',
                    value: 'yes'
                },
                {
                    title: 'No',
                    value: 'no'
                }
            ],
            initial: 0
        }))

    const screenshot = (['yes', 'no', 'y', 'n'].includes(flags.screenshot)
        ? flags.screenshot
        : await askOrExit({
            type   : 'select',
            message: 'Make screenshots?',
            choices: [
                {
                    title: 'Yes',
                    value: 'yes'
                },
                {
                    title: 'No',
                    value: 'no'
                }
            ],
            initial: 0
        }))
    // const dir = await askSaveDirOrExit()
    const courseUrl = input[0]
    scrape(courseUrl, {
        all,
        email,
        password,
        logger,
        dir,
        concurrency,
        file,
        filePath,
        login,
        headless,
        html,
        screenshot
    }).catch(errorHandler)
})()
