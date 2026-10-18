import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './i18n/i18n.js'
import { adminAuthInit } from './lib/adminAuth.js'

// Token Google condiviso tra tutte le pagine admin (vedi lib/adminAuth.js)
adminAuthInit()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
