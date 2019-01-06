/**
 * For running game logic (i.e. game loop(s))
 */

const { NodeVM } = require('vm2');
const uuidv4 = require('uuid/v4');
const { Player, CONSTANTS, MESSAGE_TYPE, utilities } = require('./api')
const TICK_RATE = 30
const playerKeys = ['playerOne', 'playerTwo']

const context = {
    delta: 0,
    robot: {}
};

const nodeVM = new NodeVM({
    sandbox: { context },
    console: 'inherit'
});

const time = () => {
    let time = process.hrtime();
    return time[0] * 1000 + time[1] / 1000000;
}

let previous = time();
let tickLength = 1000 / TICK_RATE;
let gameStates = {};
let callMap = {
    moveForwardX: false,
    moveForwardY: false,
    moveForward: false,
    moveBackX: false,
    moveBackY: false,
    moveBack: false,
    shoot: false,
    rotate: false,
    rotateTurret: false
}

// API
// Robot control functions
const player = {

    /**
     * Moves player forwards along by x axis
     */
    moveForwardX: () => {
        if (utilities.functionCalledThisFrame(callMap, player.moveForwardX.name))
            return;

        if (utilities.checkBoundsUpperX(context.robot.x))
            context.robot.x += context.delta * CONSTANTS.MOVEMENT_SPEED;
    },

    /**
     * Moves player forwards along y axis
     */
    moveForwardY: () => {
        if (utilities.functionCalledThisFrame(callMap, player.moveBackY.name))
            return;

        if (context.robot.rotate(-1, 0, context.delta))
            if (utilities.checkBoundsUpperY(context.robot.y))
                context.robot.y -= context.delta * CONSTANTS.MOVEMENT_SPEED
    },

    /**
     * Moves player backwards along x axis
     */
    moveBackX: () => {
        if (utilities.functionCalledThisFrame(callMap, player.moveBackX.name))
            return

        if (context.robot.rotate(0, -1, context.delta))
            if (utilities.checkBoundsLowerX(context.robot.x))
                context.robot.x -= context.delta * CONSTANTS.MOVEMENT_SPEED;
    },

    /**
     * Moves player backwards along y axis
     */
    moveBackY: () => {
        if (utilities.functionCalledThisFrame(callMap, player.moveBackY.name))
            return

        if (context.robot.rotate(1, 0, context.delta))
            if (utilities.checkBoundsLowerY(context.robot.y))
                context.robot.y += context.delta * CONSTANTS.MOVEMENT_SPEED
    },

    /**
     * Moves player forwards according to its rotation
     */
    moveForward: () => {
        if (utilities.functionCalledThisFrame(callMap, player.moveForward.name))
            return

        if (!utilities.checkMapBounds(context.robot.x, context.robot.y))
            return false

        context.robot.x += context.delta * Math.cos(context.robot.rotation) * CONSTANTS.MOVEMENT_SPEED
        context.robot.y += context.delta * Math.sin(context.robot.rotation) * CONSTANTS.MOVEMENT_SPEED
        return true
    },

    /**
     * Moves layer backwards according to its rotation
     */
    moveBack: () => {
        if (utilities.functionCalledThisFrame(callMap, player.moveBack.name))
            return

        if (!utilities.checkMapBounds(context.robot.x, context.robot.y))
            return

        context.robot.x -= context.delta * Math.cos(context.robot.rotation) * CONSTANTS.MOVEMENT_SPEED
        context.robot.y -= context.delta * Math.sin(context.robot.rotation) * CONSTANTS.MOVEMENT_SPEED
    },

    /**
     * Rotates player clockwise if degrees < 0, 
     * and counter-clockwise if degrees > 0
     */
    rotate: (degrees) => {
        if (utilities.functionCalledThisFrame(callMap, player.rotate.name))
            return

        degrees += 90;
        let radians = degrees * (Math.PI / 180)
        return context.robot.rotate(Math.cos(radians), Math.sin(radians), context.delta)
    },

    /**
     * Rotates player clockwise if degrees < 0, 
     * and counter-clockwise if degrees > 0
     */
    rotateTurret: (degrees) => {
        if (utilities.functionCalledThisFrame(callMap, player.rotateTurret.name))
            return

        degrees += 90
        let radians = degrees * (Math.PI / 180)
        return context.robot.rotateTurret(Math.cos(radians), Math.sin(radians), context.delta)
    },

    /**
     * Shoots bullets by direction of turet rotation
     */
    shoot: () => {
        if (utilities.functionCalledThisFrame(callMap, player.shoot.name))
            return

        if (context.robot.energy >= CONSTANTS.BULLET_COST) {
            context.robot.createBullet()
            return true
        }

        return false
    },

    /**
     * Returns info about player
     */
    getState: () => {
        return context.robot.getObjectState();
    }
}

// For detecting enemy position
const scanner = {
    /**
     * Traces a line from where turret is pointing
     * to map border
     */
    scan: () => {

    }
}

// For logging messaget so output window
const logger = {
    log: (message, messageType) => {

        // In multiplayer no output window is available
        if(context.robot.gameType === 'M')
            return;

        context.robot.messages.push({
            message,
            type: messageType
        })
    }
}

nodeVM.freeze(player, 'player');                // Game API calls
nodeVM.freeze(CONSTANTS, 'GAME');               // Constants
nodeVM.freeze(logger, 'logger')                 // Info output
nodeVM.freeze(MESSAGE_TYPE, 'MESSAGE_TYPE')     // Logger message type

/**
 * Updates pair of players and returns their updated state
 * through web socket connection
 * @param {double} delta Time since last frame
 */
function update(delta) {
    // Iterate throug player pairs
    for (let clientID in gameStates) {
        context.delta = delta

        // Run code for each player
        playerKeys.forEach((key, index) => {
            utilities.resetCallMap(callMap)
            context.robot = gameStates[clientID][key]
            context.robot.messages = []

            try {
                gameStates[clientID].code[key].update()
            } catch (err) {
                console.log(err)
            }

            utilities.checkForHits(gameStates[clientID][playerKeys[1 ^ index]].bulletPool, context.robot, utilities.getExportedFunction(gameStates[clientID].code[key], 'onBulletHit'))
            context.robot.updateBulletPositions(context.delta, utilities.getExportedFunction(gameStates[clientID].code[key], 'onBulletMiss'))
        });

        // Send game state update
        sendUpdate(gameStates, clientID)
    }
}

function sendUpdate(gameStates, cliendId) {
    if (gameStates[cliendId].socket.readyState === 1) {
        gameStates[cliendId].socket.send(JSON.stringify({
            type: 'GAME_TICK_UPDATE',
            playerOne: gameStates[cliendId].playerOne.getObjectState(),
            playerTwo: gameStates[cliendId].playerTwo.getObjectState()
        }))
    }
}

/**
 * Calls game loop and calculates 
 * time between frames
 */
const loop = () => {
    setTimeout(loop, tickLength);
    let now = time();
    let delta = (now - previous) / 1000;
    update(delta);
    previous = now;
}

/**
 * Runs robot scripts once and
 * returns script methods
 * @param {Array} scripts 
 * @param {Array} keys 
 */
function compileScripts(scripts, keys) {
    let code = {}

    try {
        keys.forEach((key, index) => {
            code[key] = nodeVM.run(scripts[index])
        })
    } catch (err) {
        console.log(err)
    }

    return code
}

/**
 * Creates game objects used in game loop
 * @param {Array} scripts 
 * @param {Array} playerKeys 
 * @param {Object} ws 
 */
function createGameObjects(scripts, playerKeys, ws, gameType) {
    let code = compileScripts(scripts, playerKeys)
    gameStates[ws.id] = {
        playerOne: new Player(CONSTANTS.P_ONE_START_POS.X, CONSTANTS.P_ONE_START_POS.Y, 0, gameType),
        playerTwo: new Player(CONSTANTS.P_TWO_START_POS.X, CONSTANTS.P_TWO_START_POS.Y, Math.PI, gameType),
        socket: ws,
        code
    }
}

/**
 * Client connection event handler
 * @param { Object } ws Web socket object
 */
const wsServerCallback = (ws) => {

    ws.id = uuidv4();

    ws.on('message', (data) => {

        let payload = JSON.parse(data);

        switch (payload.type) {
            case 'SIMULATION':
                createGameObjects([payload.playerCode, payload.enemyCode], ['playerOne', 'playerTwo'], ws, 'S')
                break;
            case 'MULTIPLAYER':
                createGameObjects([payload.multiplayerData.playerOne.scripts[0].code,
                                   payload.multiplayerData.playerOne.scripts[0].code],
                                   ['playerOne', 'playerTwo'], ws, 'M')
                break;
            default:
                return 0;
        }
    });

    ws.send(JSON.stringify({ message: 'Reply from server', type: 'INFO' }))

    // Delete player from gameStates array
    ws.on('close', () => {
        delete gameStates[ws.id] // :(
        console.log(gameStates)
    });
}

module.exports = {
    loop,
    wsServerCallback
};

/**
 * Queue gameStates only in multiplayer.
 * When game is being created, dequeue 2 players and create pair with their
 * socket gameStates and required objects(Player, etc.)
 */

/**
 * Multiplayer
 * 1. New game is being created.
 * 2. Get 2 sockets from queue.
 * 3. Append these as pair.
 * 4. Send to each player.
 */

/**
 * Running code
 * 1.  Get module functions with NodeVM (update, start, etc..)
 * 2.  Run extracted functions in VM using vm.run(<function>)
 * 3.  Update function modifies global vm object
 * 4.  After code execution, get values of global object and assign
 *     them to player object.
 * 5. Send updated data through web socket
 */

/**
 * CODE EXECUTION
 * 1. Create context object inside sandbox
 * 2. Extract module functions through NodeVM
 * 3. Run extracted functions by stringifying them into VM run()
 */