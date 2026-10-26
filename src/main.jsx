import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// No StrictMode: the studio only runs on the dev server (its local services live there), where StrictMode runs every
// effect and render twice — every folder scan and comparison was being done twice.
createRoot(document.getElementById('root')).render(<App />)
