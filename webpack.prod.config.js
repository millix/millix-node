const path              = require('path');

module.exports = {
    target   : 'node',
    mode     : 'production',
    entry    : './index.js',
    output   : {
        filename: 'index.dist.js',
        path    : path.resolve(__dirname, '.')
    },
    externals: {
        sqlite3   : 'commonjs sqlite3',
    },
    devtool  : 'source-map',
    watch    : false,
    module   : {
        rules: [
            {
                test   : /\.js$/,
                exclude: /node_modules/,
                use    : {
                    loader : 'babel-loader',
                    options: {
                        presets    : [
                            '@babel/preset-env'
                        ],
                        plugins    : [
                            ["@babel/plugin-transform-runtime",
                             {
                                "regenerator": true
                            }]
                        ],
                        sourceMaps : 'inline',
                        retainLines: true
                    }
                },
                resolve: {
                    extensions: [
                        '.js'
                    ]
                }
            }
        ]
    },
    plugins  : [
    ]
};
