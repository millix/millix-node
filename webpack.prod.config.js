const path       = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    target : 'node',
    mode   : 'development',
    entry  : './index.js',
    output : {
        filename: 'index.dist.js',
        path    : path.resolve(__dirname, './dist')
    },
    devtool: 'inline-source-map',
    watch  : false,
    resolve: {
        alias: {
            [path.join(__dirname, 'node_modules/sqlite3/lib/sqlite3-binding.js')]: path.join(__dirname, 'database/sqlite3/sqlite3-binding.js')
        }
    },
    module : {
        rules: [
            {
                test   : /\.m?js$/,
                exclude: /node_modules/,
                use    : {
                    loader : 'babel-loader',
                    options: {
                        presets    : [
                            '@babel/preset-env'
                        ],
                        plugins    : [
                            [
                                '@babel/plugin-transform-runtime',
                                {
                                    'regenerator': true
                                }
                            ]
                        ],
                        sourceMaps : 'inline',
                        retainLines: true
                    }
                },
                resolve: {
                    extensions: [
                        '.js',
                        '.mjs'
                    ]
                }
            }
        ]
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                {
                    from: 'node_modules/sqlite3/build/**/node_sqlite3.node',
                    to  : 'build/node_sqlite3.node'
                }
            ]
        })
    ]
};
