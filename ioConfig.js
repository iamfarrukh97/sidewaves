import socketioJwt from 'socketio-jwt'
import config from '.'
import { hostTripEnd } from '../lib/autopilot/emails'
import { guestTripEnd } from '../lib/autopilot/emails'
import getActiveWatchers from '../lib/getActiveWatchers'
import { Message, Trip, User, TripGuest } from '../models'
import cron from 'node-schedule'
import { addSeconds, differenceInSeconds } from 'date-fns'
import { sendAmplitudeEvent } from '../lib'

export default io => {
  // middlewares
  io.use(
    socketioJwt.authorize({
      secret: config.JWT_SECRET,
      handshake: true
    })
  )
  io.on('connection', async socket => {
    const userId = socket.decoded_token.id
    let user = await User.findOne({ _id: userId }).lean()

    let isGuest = !user
    let watchingStream
    let isLeft = false
    const graceTime = 150 // in seconds

    console.log(`${userId} connection socket is >>`, socket.id)
    socket.join(userId)

    socket.on('startStream', async ({ tripId }) => {
      if (!tripId || !userId) return

      if (!user || (user && (!user._id || !user.name))) {
        user = await User.findOne({ _id: userId }).lean()
      }

      if (userId && cron.scheduledJobs[userId]) {
        cron.scheduledJobs[userId].cancel()
      }

      watchingStream = tripId

      socket.join(`trip-${tripId}`)

      console.log('============================')
      console.log('START ROOM SOCKETS')
      const correctSocket = await io
        .in(`trip-${tripId}`)
        .fetchSockets()
      console.log('total sockets are >>', correctSocket.length)

      correctSocket.map(tempSocket => {
        console.log('socket is >>', tempSocket.id)
      })

      console.log('============================')

      const trip = await Trip.findById(tripId).populate({
          path: 'host',
          select: 'name username avatar'
        }),
        now = new Date(),
        currentSchedule = trip.dates.find(
          y => new Date(y.start) < now && new Date(y.end) > now
        )

      if (!trip || !currentSchedule) return

      const activeWatchers = await getActiveWatchers({ trip })
      io.to(`trip-${tripId}`).emit(
        'SET_LIVE_TRIP_USERS',
        activeWatchers
      )

      const messages = await Message.find({
        scheduleId: currentSchedule._id
      })
        .populate({ path: 'sender', select: 'avatar name' })
        .sort('-createdAt')
        .lean()

      let updateQuery = {}

      updateQuery['$set'] = { live: true }
      let updateData = {
        _id: tripId,
        live: true
      }

      //add actual start time only on the first time
      if (!currentSchedule.startedAt) {
        let updatedTrip = await Trip.findOneAndUpdate(
          { _id: tripId, 'dates._id': currentSchedule._id },
          {
            $set: {
              'dates.$.startedAt': now
            }
          },
          {
            new: true
          }
        )
        updateData['dates'] = updatedTrip.dates
      }

      io.emit(
        'UPDATE_TRIP',
        { ...updateData, watchers: trip.watchers }
        // live: trip.host.equals(userId) || trip.live,
        // watchers: trip.host.equals(userId)
        //   ? trip.watchers
        //   : [...new Set([...trip.watchers, userId])]
      )

      await trip.updateOne(updateQuery)

      io.to(userId).emit('SET_MESSAGES', { messages, tripId })
    })

    socket.on('joinStream', async ({ hostId, tripId }) => {
      if (!tripId || !userId) return
      console.log(
        `${user && user.name} having socket ${
          socket.id
        } joining ${tripId}`
      )

      if (!user || (user && (!user._id || !user.name))) {
        user = await User.findOne({ _id: userId }).lean()
      }

      watchingStream = tripId

      const trip = await Trip.findById(tripId).populate({
          path: 'host',
          select: 'name username avatar'
        }),
        now = new Date(),
        currentSchedule = trip.dates.find(
          y => new Date(y.start) < now && new Date(y.end) > now
        )
      if (
        !trip ||
        !currentSchedule ||
        (currentSchedule && currentSchedule.endedAt)
      )
        return

      if (
        (hostId && hostId === userId) ||
        (trip.host && trip.host._id && trip.host._id === userId)
      ) {
        if (trip.live) {
          if (userId && cron.scheduledJobs[userId]) {
            cron.scheduledJobs[userId].cancel()
          }
          const updateTrip = await Trip.findByIdAndUpdate(
            trip._id,
            {
              live: false
            },
            { new: true }
          )
          if (!updateTrip._id) return
          io.emit('UPDATE_TRIP', {
            _id: updateTrip._id,
            live: false
          })
        }
        return
      }

      socket.join(`trip-${tripId}`)

      console.log('============================')
      console.log('JOIN ROOM SOCKETS')
      const correctSocket = await io
        .in(`trip-${tripId}`)
        .fetchSockets()
      console.log('total sockets are >>', correctSocket.length)

      correctSocket.map(tempSocket => {
        console.log('socket is >>', tempSocket.id)
      })

      console.log('============================')

      const foundGuest = trip.totalGuests.find(
        guest => guest && guest.user + '' === userId + ''
      )

      if (!foundGuest) {
        const guests = [
          ...trip.totalGuests,
          {
            user: userId,
            start: now
          }
        ]
        await trip.updateOne({
          totalGuests: guests
        })
        io.emit('UPDATE_TRIP', {
          _id: tripId,
          totalGuests: guests
        })
      } else if (foundGuest && foundGuest.end) {
        const tempTrip = await Trip.findById(tripId).lean()
        let guests = [...tempTrip.totalGuests]
        guests = guests.map(g => {
          let tempGuest = { ...g }
          if (tempGuest._id + '' === foundGuest._id + '') {
            delete tempGuest['end']
          }
          return tempGuest
        })
        await trip.updateOne({
          totalGuests: guests
        })
        io.emit('UPDATE_TRIP', {
          _id: tripId,
          totalGuests: guests
        })
      }

      await trip.updateOne({
        $addToSet: {
          watchers: userId
        }
      })

      const activeWatchers = await getActiveWatchers({ trip })
      io.to(`trip-${tripId}`).emit(
        'SET_LIVE_TRIP_USERS',
        activeWatchers
      )

      io.emit('UPDATE_TRIP', {
        _id: tripId,
        live: trip && trip.live,
        watchers: [...new Set([...trip.watchers, userId])]
      })

      const messages = await Message.find({
        scheduleId: currentSchedule._id
      })
        .populate({ path: 'sender', select: 'avatar name' })
        .sort('-createdAt')
        .lean()

      io.to(userId).emit('SET_MESSAGES', {
        messages,
        tripId
      })
    })

    socket.on('sendMessage', async data => {
      const { text, tripId, type, isGuest } = data

      if (!isGuest) {
        if (!userId) return
        if (!user || (user && (!user._id || !user.name))) {
          user = await User.findOne({ _id: userId }).lean()
        }
        if (!user) return

        io.to(`trip-${tripId}`).emit('NEW_MESSAGE', {
          text,
          sender: {
            _id: user._id,
            name: user.name,
            avatar: user.avatar
          },
          tripId,
          type: type ? type : ''
        })
        await Message.create({
          ...data,
          sender: userId
        })
      } else {
        io.to(`trip-${tripId}`).emit('NEW_MESSAGE', {
          text,
          isGuest,
          tripId,
          type: type ? type : ''
        })
        await Message.create({
          ...data
        })
      }
    })

    socket.on('locationShare', async data => {
      if (!userId || !user) return
      if (!user || (user && (!user._id || !user.name))) {
        user = await User.findOne({ _id: userId }).lean()
      }

      const { tripId, coords } = data
      io.to(`trip-${tripId}`).emit('onLocationRecieve', { coords })
    })

    socket.on('leaveStream', async tripId => {
      if (!tripId || !userId) return
      if (!user || (user && (!user._id || !user.name))) {
        user = await User.findOne({ _id: userId }).lean()
      }
      console.log(
        `${user && user.name} having userId >>> ${userId} socket ${
          socket.id
        } leaving ${tripId}`
      )
      // get the trip
      let trip = await Trip.findById(tripId).populate({
        path: 'host',
        select: 'name username avatar'
      })

      let updateQuery = {
        $pull: { watchers: userId }
      }

      if (trip.host.equals(userId)) {
        await User.findByIdAndUpdate(userId, {
          isStreaming: false
        })

        updateQuery['live'] = false
        io.emit('UPDATE_TRIP', {
          _id: tripId,
          live: false
        })
      } else {
        let now = new Date()
        await Trip.findOneAndUpdate(
          { _id: tripId, 'totalGuests.user': userId },
          {
            $set: {
              'totalGuests.$.end': now
            }
          }
        )
      }
      await trip.updateOne(updateQuery)

      const activeWatchers = await getActiveWatchers({ trip })
      io.to(`trip-${tripId}`).emit(
        'SET_LIVE_TRIP_USERS',
        activeWatchers
      )

      const filteredWatchers = trip.watchers.filter(
        watcher => watcher !== userId
      )
      io.emit('UPDATE_TRIP', {
        _id: tripId,
        watchers: filteredWatchers
      })

      watchingStream = null
      io.to(`trip-${tripId}`).emit('leaveStream', {
        tripId,
        userId,
        hostLeft: trip.host.equals(userId)
      })
      socket.leave(`trip-${tripId}`)
      console.log('============================')
      console.log('LEAVE ROOM SOCKETS')
      const correctSocket = await io
        .in(`trip-${tripId}`)
        .fetchSockets()
      console.log('total sockets are >>', correctSocket.length)
      correctSocket.map(tempSocket => {
        console.log('socket is >>', tempSocket.id)
      })
      console.log('============================')
    })

    //removing guest from total if the guest joins as a user
    //during live tour
    socket.on('removeGuestFromTotal', async () => {
      console.log('=========================')
      console.log(`Removing guest from total for ${userId}`)
      console.log('=========================')

      let trip = null
      let isTripEnded = false
      if (watchingStream) {
        trip = await Trip.findById(watchingStream)
        let now = new Date()
        let currentSchedule = trip.dates.find(
          y => new Date(y.start) < now && new Date(y.end) > now
        )

        if (currentSchedule && currentSchedule.endedAt) {
          isTripEnded = true
        }
      }

      if (!trip || isTripEnded) return

      let updateQuery = {
        $pull: { totalGuests: { user: userId } }
      }

      const updateTrip = await Trip.findByIdAndUpdate(
        trip._id,
        updateQuery,
        { new: true }
      )

      if (updateTrip && updateTrip.host + '' !== userId + '') {
        io.emit('UPDATE_TRIP', {
          _id: updateTrip._id,
          totalGuests: updateTrip.totalGuests
        })
      }
    })

    // use to detect if host closed the app
    // before the socket disconnected
    // so in disconnect, we can use it to close and
    // clean the trip properly
    socket.on('allowRemoval', async ({ state }) => {
      isLeft = state
    })

    //if the guest joins as host remove the watching tour id
    //so that it will not be false on host disconnect
    socket.on('removeWatchingStream', async () => {
      console.log('=========================')
      console.log(`Removing watching stream for ${userId}`)
      console.log('=========================')
      watchingStream = null
    })

    socket.on('endStream', async ({ tripId, scheduleId, date }) => {
      const streamDetails = await Trip.findById(tripId)
        .populate({
          path: 'host',
          select: 'name'
        })
        .lean()
      const schedule =
        streamDetails &&
        streamDetails.dates &&
        streamDetails.dates.find(
          date => date._id.toString() === scheduleId.toString()
        )
      let tripGuestTotal = []
      let now = new Date()
      if (streamDetails && streamDetails.totalGuests && schedule) {
        for (let guest of streamDetails.totalGuests) {
          const guestUser = await User.findById(guest.user)
            .select('name username type')
            .lean()
          sendAmplitudeEvent({
            id: guestUser ? guestUser._id + '' : guest.user + '',
            name: 'UTourWatched',
            data: {
              user_id: guestUser
                ? guestUser._id + ''
                : guest.user + '',
              is_host:
                guestUser && guestUser.type === 'host' ? true : false,
              host_user_id: streamDetails.host._id + '',
              host_name: streamDetails.host.name,
              tour_id: streamDetails._id,
              scheduled_start_time: schedule.start,
              scheduled_end_time: schedule.end,
              actual_start_time: schedule.startedAt,
              actual_end_time: new Date(date),
              tour_name: streamDetails.name,
              scheduled_duration: differenceInSeconds(
                new Date(schedule.end),
                new Date(schedule.start)
              ),
              actual_duration: differenceInSeconds(
                new Date(date),
                new Date(schedule.startedAt)
              ),
              watched_duration: differenceInSeconds(
                guest.end ? new Date(guest.end) : new Date(date),
                new Date(guest.start)
              ),
              tour_location: streamDetails.location.name,
              tour_language: streamDetails.language,
              tour_tags: streamDetails.tags.join(', '),
              price: streamDetails.price,
              timestamp: new Date()
            }
          })
        }
        tripGuestTotal = streamDetails.totalGuests.map(g => {
          if (g.end) {
            return g
          } else {
            return {
              ...g,
              end: now
            }
          }
        })
      }

      const tripGuestCreated = await TripGuest.create({
        tripId: tripId,
        tripTitle: streamDetails.name,
        scheduleId: scheduleId,
        host: streamDetails.host._id,
        totalGuests: tripGuestTotal,
        start: schedule.start,
        startedAt: schedule.startedAt,
        end: schedule.end,
        endedAt: date
      })
      await User.findByIdAndUpdate(userId, {
        isStreaming: false
      })

      await Trip.findOneAndUpdate(
        { _id: tripId, 'dates._id': scheduleId },
        {
          $set: {
            'dates.$.endedAt': date,
            live: false,
            watchingCount: 0,
            watchers: [],
            totalGuests: [],
            tripGuests: tripGuestCreated._id
          }
        }
      )

      io.emit('END_TRIP', {
        _id: tripId,
        scheduleId,
        date,
        watchers: []
      })
      watchingStream = null

      // check to remove the room completely
      io.in(`trip-${tripId}`).socketsLeave(`trip-${tripId}`)

      const tempHost = await User.findById(userId).select(
        'name email'
      )
      const tempTrip = await Trip.findById(tripId).lean()

      //send tour end autopilot email
      hostTripEnd({
        user: tempHost,
        trip: tempTrip
      })

      const index =
        tempTrip &&
        tempTrip.dates &&
        tempTrip.dates.findIndex(
          date => date._id.toString() === scheduleId.toString()
        )

      const currentSchedule =
        tempTrip && tempTrip.dates && tempTrip.dates.length > 0
          ? tempTrip.dates[index]
          : null

      if (!currentSchedule) return
      if (
        currentSchedule &&
        currentSchedule.users &&
        currentSchedule.users.length > 0
      ) {
        for (let userId of currentSchedule.users) {
          const user = await User.findById(userId).select(
            'name email'
          )
          guestTripEnd({
            host: tempHost,
            trip: tempTrip,
            user
          })
        }
      }

      sendAmplitudeEvent({
        id: userId,
        name: 'UTourHosted',
        data: {
          user_id: userId,
          is_host: true,
          host_name: tempHost.name,
          tour_id: tempTrip._id,
          is_private: tempTrip.triptype === 'private' ? true : false,
          scheduled_start_time: currentSchedule.start,
          scheduled_end_time: currentSchedule.end,
          actual_start_time: currentSchedule.startedAt,
          actual_end_time: date,
          tour_name: tempTrip.name,
          scheduled_duration: differenceInSeconds(
            new Date(currentSchedule.end),
            new Date(currentSchedule.start)
          ),
          actual_duration: differenceInSeconds(
            new Date(date),
            new Date(currentSchedule.startedAt)
          ),
          tour_location: tempTrip.location.name, // not
          tour_language: tempTrip.language, // not
          tour_tags: tempTrip.tags.join(', '),
          price: tempTrip.price
        }
      })

      // socket.leave(`trip-${tripId}`)
    })

    socket.on('disconnect', async () => {
      if (!user && isGuest) {
        console.log(`Guest is disconneting from socket >>`, socket.id)
      } else {
        if (!user) return

        console.log(
          `${user.name} is disconneting from socket >>`,
          socket.id
        )
        await User.findByIdAndUpdate(userId, {
          isStreaming: false
        })
      }

      let trip = null
      if (watchingStream) {
        trip = await Trip.findById(watchingStream)
      }

      if (!trip) return

      const activeWatchers = await getActiveWatchers({ trip })
      io.to(`trip-${watchingStream}`).emit(
        'SET_LIVE_TRIP_USERS',
        activeWatchers
      )

      let updateQuery = {
        $pull: { watchers: userId }
      }
      if (trip && trip.host + '' === userId) {
        const clearHost = async () => {
          updateQuery['live'] = false
          const updateTrip = await Trip.findByIdAndUpdate(
            trip._id,
            updateQuery,
            { new: true }
          )

          await User.findByIdAndUpdate(userId, {
            isStreaming: false
          })

          if (!updateTrip._id) return
          io.to(`trip-${updateTrip._id}`).emit('leaveStream', {
            tripId: updateTrip._id,
            userId,
            hostLeft: trip.host.equals(userId)
          })
          io.emit('UPDATE_TRIP', {
            _id: updateTrip._id,
            live: false
          })
          if (watchingStream) {
            socket.leave(`trip-${watchingStream}`)
          }
          watchingStream = null
        }
        if ((trip.live && isLeft) || !trip.live) {
          clearHost()
        } else {
          const cronDate = addSeconds(new Date(), graceTime)
          cron.scheduleJob(userId, cronDate, async () => {
            clearHost()
          })
        }
      } else {
        let now = new Date()

        await Trip.findOneAndUpdate(
          { _id: trip._id, 'totalGuests.user': userId },
          {
            $set: {
              'totalGuests.$.end': now
            }
          }
        )

        const updateTrip = await Trip.findByIdAndUpdate(
          trip._id,
          updateQuery,
          { new: true }
        )
        io.emit('UPDATE_TRIP', {
          _id: updateTrip._id,
          watchers: updateTrip.watchers
        })
        if (watchingStream) {
          socket.leave(`trip-${watchingStream}`)
        }
        watchingStream = null
      }
    })
  })
}
