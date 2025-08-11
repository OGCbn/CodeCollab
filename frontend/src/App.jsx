import { use, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { io } from 'socket.io-client'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000'
const WS_BASE = import.meta.env.VITE_WS_BASE || 'http://localhost:5000/ws'

export default function App () {
    const [room, setRoom] = useState('demo')
    const [code, setCode] = useState('// Start collaborating...')
    const socketRef = useRef(null)

    useEffect(() =>{
        const socket = io(WS_BASE, { path: '/socket.io', transports: ['websockets'], auth: { token: yourJwt}})
        socketRef.current = socket
        //on connection tell the room a "guest" has joined
        socket.on('connect', () => {
            socket.emit('join', {room, user: 'guest'})
        })
        //on outside code update, update the current code state with the changes
        socket.on('code_update', (payload) => {
            if (payload?.delta) {
                setCode(payload.delta)
            }
        })
        //close the current websocket and leave the room
        return () => {
            socket.emit('leave', { room, user: 'guest'})
            socket.disconnect()
        }
        //this will be done very time you enter a new room
    }, [room])

    //update the local state on edit and broadcast to others in the same room 
    const timer = useRef(null)
    const handleChange = (value) => {
        setCode(value)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            socketRef.current?.emit('code_change', {room, delta: value})
        }, 100)
    }

    //health check to verify the backend is ok
    const checkHealth = async () => {
        const { data } = await axios.get(`${API_BASE}/health`)
        alert('Backend: ' + JSON.stringify(data))
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 p-4 space-y-4">
            <header className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">CodeCollab AI</h1>
                <button onClick={checkHealth} className="px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700">
                Check Backend
                </button>
            </header>

            <div className="flex items-center gap-2">
                <label>Room:</label>
                <input value={room} onChange={e => setRoom(e.target.value)} className="px-2 py-1 rounded bg-gray-800" />
            </div>

            <div className="rounded-2xl overflow-hidden shadow">
                <Editor
                height="70vh"
                theme="vs-dark"
                defaultLanguage="javascript"
                value={code}
                onChange={handleChange}
                options={{ fontSize: 14, minimap: { enabled: false } }}
                />
            </div>
        </div>
    )
}