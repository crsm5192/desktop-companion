import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ChatPanel from './components/chat/ChatPanel'
import './styles/global.css'

// 去掉 StrictMode：它的「开发模式双重挂载」会让 Live2D 的 WebGL 画布在加载中途被销毁一次
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  window.location.hash === '#chat' ? <ChatPanel /> : <App />
)
