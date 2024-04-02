const express = require("express");
const app = express()
const jwt = require('jsonwebtoken');

const {mongoose} = require('./db/mongoose')

const bodyParser = require('body-parser')

// load in the mongoose models
const {User, List, Task} = require('./db/models')

// MIDDLEWARE

// Load middleware
app.use(bodyParser.json())

// CORS HEADERS MIDDLEWARE
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
    
    // this below line added because without it patch method doesn't work
    res.header("Access-Control-Allow-Methods","GET, POST, HEAD, OPTIONS, PUT, PATCH, DELETE");

    // for refresh and access token to get in the localStorage
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-access-token, x-refresh-token, _id");
    res.header('Access-Control-Expose-Headers','x-access-token, x-refresh-token');

    next();
  });

  // check whether the request has a valid JWT access token 
  // we can use this middleware's method to implement authentication for different route
  let authenticate =(req, res, next) => {
      let token = req.header('x-access-token')

      // verify the  JWT
      jwt.verify(token, User.getJWTSecret(),(err, decoded)=>{
        if(err){
           // there was an error
           // jwt is invalid - DO NOT AUTHENTICATE
           res.status(401).send(err) 
           console.log('here is error')
        } else {
            // jwt is valid
            req.user_id = decoded._id;
            next();
        }
      } )

  }


// verify Refresh Token Middleware (which will be verifying the session)
let verifySession = (req, res, next)=>{
    // grab the refresh token from the request header
    let refreshToken = req.header('x-refresh-token');
    
    // grab the _id from the request header
    let _id = req.header('_id');
    
    User.findByIdAndToken(_id, refreshToken).then((user)=>{
        if(!user){
            // user could not be found
            return Promise.reject({
                'error': 'User not found. Make sure that the refresh token and user id are correct.'
            })
        } else { 
    // if the code reaches here - the user was found
    // therefore the refresh token exists in the database - but we still have to check if it has expired or not
    
    req.user_id = user._id;
    req.userObjet = user;
    req.refreshToken = refreshToken;
    
    let isSessionValid = false;
    
    user.sessions.forEach((session)=>{
        if(session.token === refreshToken){
        // check if the session has expired
       if(User.hasRefreshTokenExpired(session.expiresAt)=== false){
        // refresh token has not expired
        isSessionValid = true;
       }
        }
    })
    if(isSessionValid){
        // the session is VALID - call next() to continue with processing this web request
        next();
    } else {
        // the session is not valid
        return Promise.reject({
            'error': 'Refresh token has expired or the session is invalid'
        })
    }}}).catch((e)=>{
        res.status(401).send(e)
    })
    
    }

// END MIDDLEWARE
// List routes 

app.get('/lists', authenticate , (req,res)=>{
  // we want to return an array of all the lists that belong to the authenticated user
 List.find({_userId: req.user_id}).then((lists)=>{
  res.send(lists)
 }).catch((e)=>{
    res.send(e)
 })
})

app.post('/lists',authenticate, (req,res)=>{
    let title = req.body.title
    let newList = new List({
        title,
        _userId: req.user_id
    })
    newList.save().then((listDoc)=>{
     res.send(listDoc)
    })
})

app.patch('/lists/:id', authenticate, (req,res)=>{
    List.findOneAndUpdate({_id: req.params.id, _userId: req.user_id},{
        $set: req.body
    }).then(()=>{
        res.send({ 'message': 'updated successfully'});
    })
})

app.delete('/lists/:id',authenticate, (req,res)=>{
    List.findOneAndDelete({
        _id:req.params.id,
        // this user id to give them permission to delete only their lists
        _userId: req.user_id
    }).then((removedListDoc)=>{
        res.send(removedListDoc);

        // delete all the tasks that are in the deleted list
        deleteTasksFromList(removedListDoc._id);
    })
})


// Tasks routes 

app.get('/lists/:listId/tasks', authenticate, (req, res) => {
    // We want to return all tasks that belong to a specific list (specified by listId)
    Task.find({
        _listId: req.params.listId
    }).then((tasks) => {
        res.send(tasks);
    })
});

   // get task by id or get single task : commented as not using right now 
//    app.get('/lists/:listId/tasks/:taskId', (req,res)=>{
//     Task.find({
//         _id:req.params.taskId,
//        _listId: req.params.listId 
//     }).then((task)=>{
//         res.send(task);
//     })
// })

app.post('/lists/:listId/tasks', authenticate, (req, res) => {
    // We want to create a new task in a list specified by listId

    List.findOne({
        _id: req.params.listId,
        _userId: req.user_id
    }).then((list) => {
        if (list) {
            // list object with the specified conditions was found
            // therefore the currently authenticated user can create new tasks
            return true;
        }

        // else - the list object is undefined
        return false;
    }).then((canCreateTask) => {
        if (canCreateTask) {
            let newTask = new Task({
                title: req.body.title,
                _listId: req.params.listId
            });
            newTask.save().then((newTaskDoc) => {
                res.send(newTaskDoc);
            })
        } else {
            res.sendStatus(404);
        }
    })
})

app.patch('/lists/:listId/tasks/:taskId', authenticate, (req, res) => {
    // We want to update an existing task (specified by taskId)

    List.findOne({
        _id: req.params.listId,
        _userId: req.user_id
    }).then((list) => {
        if (list) {
            // list object with the specified conditions was found
            // therefore the currently authenticated user can make updates to tasks within this list
            return true;
        }

        // else - the list object is undefined
        return false;
    }).then((canUpdateTasks) => {
        if (canUpdateTasks) {
            // the currently authenticated user can update tasks
            Task.findOneAndUpdate({
                _id: req.params.taskId,
                _listId: req.params.listId
            }, {
                    $set: req.body
                }
            ).then(() => {
                res.send({ message: 'Updated successfully.' })
            })
        } else {
            res.sendStatus(404);
        }
    })
});

app.delete('/lists/:listId/tasks/:taskId', authenticate, (req, res) => {

    List.findOne({
        _id: req.params.listId,
        _userId: req.user_id
    }).then((list) => {
        if (list) {
            // list object with the specified conditions was found
            // therefore the currently authenticated user can make updates to tasks within this list
            return true;
        }

        // else - the list object is undefined
        return false;
    }).then((canDeleteTasks) => {
        
        if (canDeleteTasks) {
            Task.findOneAndDelete({
                _id: req.params.taskId,
                _listId: req.params.listId
            }).then((removedTaskDoc) => {
                res.send(removedTaskDoc);
            })
        } else {
            res.sendStatus(404);
        }
    });
});

// User routes

// User sign up 
app.post('/users/signup', (req, res)=>{

   let body = req.body;
   let newUser = new User(body);

   newUser.save().then(()=>{
    return newUser.createSession()
   }).then((refreshToken)=>{
    // Session created successfully - refreshToken returned.
    // now we generate an access auth token for the user

    return newUser.generateAccessAuthToken().then((accessToken)=>{
    // access auth token generated successfully, now we return an object containing the auth tokens
    return{accessToken, refreshToken}
    })
   }).then((authTokens)=>{
    res
    .header('x-refresh-token', authTokens.refreshToken)
    .header('x-refresh-token', authTokens.accessToken)
    .send(newUser)
   }).catch((e)=>{
    res.status(400).send(e);
   })
})

// User login
app.post('/users/login', (req, res)=>{
    let email = req.body.email;
    let password = req.body.password;

    User.findByCredentials(email, password).then((user)=>{
        return user.createSession().then((refreshToken)=>{
            // Session created successfully - refreshToken returned.
            // now we generate an access auth token for the user

        return user.generateAccessAuthToken().then((accessToken)=>{
            // access auth token gene
           return { accessToken, refreshToken}      
        });
        }).then((authTokens)=>{
             // Now we construct and send the response to the user with their auth tokens in the header and the user object in the body
            res
            .header('x-refresh-token', authTokens.refreshToken)
            .header('x-access-token', authTokens.accessToken)
            .send(user)
        })
    }).catch((e)=>{
        res.status(400).send(e)
    })
})
// generates and returns an access token

app.get('/users/me/access-token', verifySession, (req, res)=>{
// we know that the user/caller is authenticated and we have the user_id and user object available to us
req.userObjet.generateAccessAuthToken().then((accessToken)=>{
    res.header('x-access-token', accessToken).send({accessToken});
}).catch((e)=>{
  res.status(400).send(e)  
})
})

app.get('/',(req, res)=>{
res.send("Hello world")
})

// HELPER METHODS

let deleteTasksFromList = (_listId) => {
    Task.deleteMany({
        _listId
    }).then(() => {
        console.log("Tasks from " + _listId + " were deleted!");
    })
}

app.listen(3000, ()=>{
    console.log("server is listening on port 3000")
})
