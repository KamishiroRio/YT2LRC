import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import { Authenticator } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'
import outputs from '../amplify_outputs.json'
import App from './App.tsx'
import './index.css'

Amplify.configure(outputs)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Authenticator>
      <App />
    </Authenticator>
  </StrictMode>,
)
