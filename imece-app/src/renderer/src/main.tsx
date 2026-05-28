import React from 'react'
import ReactDOM from 'react-dom/client'
import { installBrowserMock } from './lib/mock'
import App from './App'
import './styles/globals.css'

installBrowserMock()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)