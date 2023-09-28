# Downloader and scraper for teachable.com for pro members

[![npm](https://badgen.net/npm/v/tcdown)](https://www.npmjs.com/package/tcdown)
[![Downloads](https://img.shields.io/npm/dm/tcdown.svg?style=flat)](https://www.npmjs.org/package/tcdown)
[![Hits](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2Fmuhamed-didovic%2Ftcdown&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=hits&edge_flat=false)](https://hits.seeyoufarm.com)
[![license](https://flat.badgen.net/github/license/muhamed-didovic/tcdown)](https://github.com/muhamed-didovic/tcdown/blob/master/LICENSE)

## Install
```sh
npm i -g tcdown
```

#### without Install
```sh
npx tcdown
```

## CLI
```sh
Usage
    $ tcdown [CourseUrl]

Options
    --all, -a           Get all courses from particular school or provider.
    --login, -l         Your login url with login form.
    --email, -e         Your email.
    --password, -p      Your password.
    --directory, -d     Directory to save.
    --file, -f          Location of the file where are the courses
    --html, -t          Enable html download (values: 'yes' or 'no'), default value is 'yes'
    --screenshot, -s    Enable screenshot (values: 'yes' or 'no'), default value is 'yes'
    --concurrency, -c

Examples
    $ tcdown
    $ tcdown -a
    $ [DEBUG=scraper*] tcdown [url] [-l url...] [-e user@gmail.com] [-p password] [-d dirname] [-t yes/no] [-s yes/no] [-c number] [-f path-to-file]
```

## Log and debug
This module uses [debug](https://github.com/visionmedia/debug) to log events. To enable logs you should use environment variable `DEBUG`.
Next command will log everything from `scraper`
```bash
export DEBUG=scraper*; tcdown
```

Module has different loggers for levels: `scraper:error`, `scraper:warn`, `scraper:info`, `scraper:debug`, `scraper:log`. Please read [debug](https://github.com/visionmedia/debug) documentation to find how to include/exclude specific loggers.

## License
MIT
