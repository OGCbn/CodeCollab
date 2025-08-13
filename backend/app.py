import os
from datetime import timedelta
from flask import Flask, jsonify, request
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from dotenv import load_dotenv
from flask_cors import CORS

load_dotenv()

def create_app():
    app = Flask(__name__)

    CORS(app,
         resources={r"/*": {"origins": os.getenv("CORS_ORIGINS", "http://localhost:5173")}},
         supports_credentials=True)
    #configure flask
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")
    app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret")
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours = 6)

    #initializing JWT Manager
    jwt = JWTManager(app)

    #intializing Socket.IO- evenlet is used for WebSockets
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")


    #REST API Routes

    USERS = {} #temp in-memory store

    @app.get("/health")
    def health():
        return jsonify({"status": "ok"}), 200
    
    @app.post("/api/register")
    def register():
        """New User Registration"""
        data = request.get_json() or {}
        email = data.get("email")
        name = data.get("name")

        #failure cases
        if not email:
            return jsonify({"error": "Email required, none provided!"}), 400
        #user already registered
        if email in USERS:
            return jsonify({"error": "User is already registered!"}), 409
        USERS[email] = {"name": name or email}
        return jsonify({"ok": True}), 201
    
    @app.post("/api/login")
    def login():
        """Login and get JWT token."""
        data = request.get_json() or {}
        email = data.get("email")

        if email not in USERS:
            return jsonify({"error": "You have not created an account!"}), 401

        token = create_access_token(identity=email)
        return jsonify({"access_token": token})
    
    @app.get("/api/rooms/list")
    @jwt_required(optional=False)
    def rooms_list():
        """List all available rooms"""
        return jsonify({"rooms": []})
    
    # WebSocket Events

    @socketio.on("join", namespace="/ws")
    def on_join(data):
        room = data.get("room")
        user = data.get("user")
        join_room(room)
        emit("system", {"msg": f"{user} joined"}, to=room)
    
    @socketio.on("leave", namespace="/ws")
    def on_leave(data):
        room = data.get("room")
        user = data.get("user")
        leave_room(room)
        emit("system", {"msg": f"{user} left"}, to=room)

    @socketio.on("code_change", namespace="/ws")
    def on_code_change(data):
        room = data.get("room")
        delta = data.get("delta")
        emit("code_update", {"delta": delta}, to=room, include_self=False)
    
    #cursor movement on screen
    @socketio.on("cursor_move", namespace="/ws")
    def on_cursor_move(data):
        #data ex:
        """
        data = {room, user, pos: {lineNumber, column}}
        """
        room = data.get("room")
        emit("cursor_update", {
            "user": data.get("user"),
            "pos": data.get("pos")
        }, to=room, include_self= False)
    
    #hearbeat to show precense
    @socketio.on("presence_ping", namespace="/ws")
    def on_presence_ping(data):
        room = data.get("room")
        emit("presence_pong", {"user": data.get("user")}, to=room, include_self=False)
    
    return app, socketio

if __name__ == "__main__":
    app, socketio = create_app()
    port = int(os.getenv("PORT", "5000"))
    socketio.run(app, host="0.0.0.0", port=port)
