import { use, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { io } from 'socket.io-client'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000'
const WS_BASE = import.meta.env.VITE_WS_BASE || 'http://localhost:5000/ws'

//identify this browser tab
const makeId = () => Math.random().toString(36).slice(2, 10)

export default function App () {
    const [room, setRoom] = useState('demo')
    const [code, setCode] = useState('// Start collaborating...')
    const [peers, setPeers] = useState({}) // {userId: {pos:{lineNumber, colmn}}}

    const user = 'guest' // TODO: change to username
    const clientId = useRef(makeId()).current //id per tab

    const socketRef = useRef(null)
    const editorRef = useRef(null)
    const monacoRef = useRef(null)
    const decorationsRef = useRef([])
    const lastAppliedTsRef = useRef(0) //race condition helper: ignores older messages
    const activeRoomRef = useRef(room)
    activeRoomRef.current = room

    //debounce helper
    const debounceRef = useRef(null)
    const debounce = (fn, ms = 120) => {
        return (...args) => {
            clearTimeout(debounceRef.current)
            debounceRef.current = setTimeout(() => fn(...args), ms)
        }
    }

    useEffect(() =>{
        const socket = io(WS_BASE, {
            path: '/socket.io',
            transports: ['polling', 'websocket'], // start with polling, then upgrade to WS
            reconnection: true,
            reconnectionAttempts: 5,
            timeout: 10000,
        })

            // helpful diagnostics
        socket.on('connect', () => {
            console.log('socket connected', socket.id)
            socket.emit('join', {room, user})
        })
        socket.on('connect_error', (err) => console.error('connect_error:', err?.message || err))
        socket.io.on('reconnect_attempt', (n) => console.log('reconnect_attempt', n))
        socket.io.on('upgrade', (transport) => console.log('upgraded to', transport.name))

        //on outside code update, update the current code state with the changes
        socket.on('code_update', (payload) => {
            if (!payload || activeRoomRef.current != room) return
            //client side messages
            if (payload.clientId === clientId) return
            if (typeof payload.ts === 'number' && payload.ts <= lastAppliedTsRef.current) {
                return //stale/race conditon, ignore
            }
            lastAppliedTsRef.current = payload.ts ?? Date.now()
            if (payload.delta != undefined) setCode(payload.delta)
        })

        socket.on('cursor_update', ({user:who, pos}) =>{
            if (activeRoomRef.current !== room) return
            setPeers(prev => ({...prev, [who]: {pos}}))
            drawPeerCursors()
        })

        //close the current websocket and leave the room
        return () => {
            socket.emit('leave', { room, user: 'guest'})
            socket.disconnect()
        }
        //this will be done very time you enter a new room
    }, [room])


    //other's peer cursors (Monaco decorations)
    const drawPeerCursors = () => {
        const editor = editorRef.current
        const monaco = monacoRef.current
        if (!editor || !monaco) return

        const decos = []
        Object.entries(peers).forEach(([who, data]) => {
            const pos = data?.pos
            if (!pos) return
            const { lineNumber, column } = pos
            decos.push({
                range: new monaco.Range(lineNumber, column, lineNumber, column),
                options: {
                    className: 'peer-cursor-line',
                    isWholeLine: false,
                    after: {
                        content: ` ${who}`,
                        inlineClassName: 'peer-cursor-label'
                    }
                }
            })
        })
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decos)
    }

    //wire cursor events
    const onMount = (editor, monaco) => {
        editorRef.current = editor
        monacoRef.current = monaco

        //emit caret position
        const emitCursor = (() => {
        let last = 0
        return () => {
            const now = Date.now()
            if (now - last < 60) return
            last = now
            const pos = editor.getPosition()
            socketRef.current?.emit('cursor_move', { room, user, pos })
        }
        })()

        editor.onDidChangeCursorPosition(emitCursor)
        editor.onDidScrollChange(emitCursor)
        drawPeerCursors()
    }

    //code change handlers

    //debounced emits
    const emitCodeChange = debounce((value) => {
        const ts = Date.now()
        // local guard: our own latest ts (so a late-arriving remote packet won't overwrite)
        if (ts > lastAppliedTsRef.current) lastAppliedTsRef.current = ts
        socketRef.current?.emit('code_change', { room, delta: value, ts, user, clientId })
    }, 120)

    //update the local state on edit and broadcast to others in the same room 
    const handleChange = (value) => {
        setCode(value)
        emitCodeChange(value)
    }

    //health check to verify the backend is ok
    const checkHealth = async () => {
        const { data } = await axios.get(`${API_BASE}/health`)
        alert('Backend: ' + JSON.stringify(data))
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 p-4 space-y-4">
            <style>{`
                .peer-cursor-line { border-left: 2px solid #8ab4f8; }
                .peer-cursor-label { background:#1f2937;border-radius:6px;padding:0 6px; }
            `}</style>

            <header className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">CodeCollab AI</h1>
                <button onClick={checkHealth} className="px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700">
                Check Backend
                </button>
            </header>

            <div className="flex items-center gap-2">
                <label>Room:</label>
                <input
                value={room}
                onChange={e => setRoom(e.target.value)}
                className="px-2 py-1 rounded bg-gray-800"
                />
            </div>

            <div className="rounded-2xl overflow-hidden shadow">
                <Editor
                height="70vh"
                theme="vs-dark"
                defaultLanguage="javascript"
                value={code}
                onChange={handleChange}
                onMount={onMount}
                options={{ fontSize: 14, minimap: { enabled: false } }}
                />
            </div>
        </div>
    )
}