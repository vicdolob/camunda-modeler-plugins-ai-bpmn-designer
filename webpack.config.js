const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: {
    client: './client/client.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'var',
    library: '__aiBpmnDesigner'
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { electron: '28' } }],
              ['@babel/preset-react', { runtime: 'classic' }]
            ]
          }
        }
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      },
      {
        test: /\.md$/,
        type: 'asset/source'
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx']
  },
  externals: {
    'react': 'var window.react',
    'react-dom': 'var window.reactDOM'
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: 'style.css' })
  ],
  performance: {
    maxEntrypointSize: 2000000,
    maxAssetSize: 2000000
  }
};
