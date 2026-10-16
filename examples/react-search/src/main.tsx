import '@mantine/core/styles.css'
import './setup'
import './debug'

import ReactDOM from 'react-dom/client'

import { App } from './app'

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<App />)
