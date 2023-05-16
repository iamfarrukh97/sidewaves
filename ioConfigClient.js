import SocketIO from "socket.io-client";
import { getToken, setToken, streaming } from "core";
import env from "./env";
import { store } from "../store";
import { Api } from "lib";

const WS_URL = env.WS_URL;

let socketConnected;
let conn;
let isCreatingConnection;
let isGuest = false;

// const { dispatch } = store
async function ioConnect() {
  let token;
  if (!conn) {
    token = await getToken();
    //only if user is not logged in
    if (
      !token ||
      (token &&
        (token === "undefined" || token.length <= 0 || token === "null"))
    ) {
      // isGuest = true
      const { guestToken, id } = await Api.get("/services/getToken");

      if (!guestToken) return;
      setToken(guestToken);
      token = guestToken;

      store.dispatch({
        type: "SET_GUEST",
        payload: {
          _id: id,
        },
      });
    }

    conn = SocketIO(WS_URL, {
      query: "token=" + token,
    });

    conn.connect();
  }

  if (conn && !socketConnected) {
    conn.connect();

    conn.on("connect", () => {
      store.dispatch({
        type: "IS_SOCKET_DISCONNECTED",
        payload: false,
      });
      console.log("WS connected");
    });

    conn.on("NEW_SIGNUP", ({ data, notifData }) => {
      // TODO: should also update the trip
      store.dispatch({
        type: "NEW_SIGNUP",
        payload: data,
      });

      store.dispatch({
        type: "NEW_NOTIFICATION",
        payload: notifData,
      });
    });

    conn.on("SET_MESSAGES", (data) => {
      store.dispatch({
        type: "SET_MESSAGES",
        payload: data,
      });
    });

    conn.on("NEW_MESSAGE", (data) => {
      store.dispatch({
        type: "NEW_MESSAGE",
        payload: data,
      });
    });

    // removing current user from live guests
    conn.on("SET_LIVE_TRIP_USERS", (data) => {
      let tempUsers = [...data.liveTripUsers];
      let userId =
        store.getState() && store.getState().user && store.getState().user._id
          ? store.getState().user._id
          : null;

      if (userId) {
        tempUsers = tempUsers.filter((u) => {
          return u._id + "" !== userId + "";
        });
      }
      store.dispatch({
        type: "SET_LIVE_TRIP_USERS",
        payload: {
          ...data,
          liveTripUsers: tempUsers,
        },
      });
    });

    conn.on("UPDATE_USER", (data) => {
      store.dispatch({
        type: "UPDATE_USER",
        payload: data,
      });
    });

    conn.on("UPDATE_CHAT", (data) => {
      store.dispatch({
        type: "UPDATE_CHAT",
        payload: data,
      });

      store.dispatch({
        type: "SET_CHAT_REFRESH",
        payload: true,
      });
    });

    conn.on("UPDATE_TRIP", (data) => {
      store.dispatch({
        type: "UPDATE_TRIP",
        payload: data,
      });
    });

    conn.on("DELETE_TRIP", (data) => {
      if (!data || (data && !data.tripId)) return;
      store.dispatch({
        type: "DELETE_TRIP",
        payload: data.tripId,
      });
    });

    conn.on("USER_CANCELLED_TRIP", (data) => {
      store.dispatch({
        type: "USER_CANCELLED_TRIP",
        payload: data,
      });
    });

    conn.on("NEW_FOLLOWER", (data) => {
      store.dispatch({
        type: "NEW_FOLLOWER",
        payload: data,
      });
    });

    conn.on("UNFOLLOWED", (data) => {
      store.dispatch({
        type: "UNFOLLOWED",
        payload: data,
      });
    });
    conn.on("REMOVE_SAVED_TRIPS", (data) => {
      store.dispatch({
        type: "REMOVE_SAVED_TRIPS",
        payload: data,
      });
    });
    conn.on("REFRESH_ON_BLOCK", (data) => {
      store.dispatch({
        type: "REFRESH_ON_BLOCK",
      });
    });
    conn.on("REMOVE_FOLLOWING", (data) => {
      const nData = { _id: data };
      store.dispatch({
        type: "UNFOLLOW_USER",
        payload: nData,
      });
    });

    conn.on("NEW_NOTIFICATION", (data) => {
      store.dispatch({
        type: "NEW_NOTIFICATION",
        payload: data.notifData,
      });
    });

    conn.on("END_TRIP", (data) => {
      store.dispatch({
        type: "END_TRIP",
        payload: data,
      });
    });

    conn.on("NEW_CHAT_MESSAGE", (data) => {
      store.dispatch({
        type: "NEW_CHAT_MESSAGE",
        payload: data,
      });
    });

    conn.on("NEW_BULK_CHAT_MESSAGES", (data) => {
      store.dispatch({
        type: "NEW_BULK_CHAT_MESSAGES",
        payload: data,
      });
    });

    conn.on("NEW_CHAT", (data) => {
      store.dispatch({
        type: "NEW_CHAT",
        payload: data,
      });
    });

    conn.on("SET_LATEST_MESSAGE", (data) => {
      store.dispatch({
        type: "SET_LATEST_MESSAGE",
        payload: data,
      });
    });

    // conn.on('HOST_LEFT', data => {
    //   store.dispatch({
    //     type: 'HOST_LEFT',
    //     payload: data
    //   })
    // })

    // USER received a new offer from another user
    conn.on("newOffer", (data) => {
      // TODO: update trip.watchers in redux
      streaming.onOffer(data);
    });

    // a USER left live stream
    conn.on("leaveStream", (data) => {
      if (!data.hostLeft) {
        store.dispatch({
          type: "GUEST_LEFT",
          payload: data,
        });
      }
      // TODO: update trip.watchers in redux
    });

    conn.on("removePrivateTrip", (data) => {
      store.dispatch({
        type: "REMOVE_PRIVATE_TRIP",
        payload: data.tripId,
      });
    });

    conn.on("addNewTrip", (data) => {
      store.dispatch({
        type: "ADD_TRIPS",
        payload: data,
      });
    });

    conn.on("onLocationRecieve", (data) => {
      const { coords } = data;
      store.dispatch({
        type: "SET_HOST_LOCATION",
        payload: coords,
      });
    });

    conn.on("onSendTip", (data) => {
      const { tip } = data;
      store.dispatch({
        type: "SET_TOTAL_TIP",
        payload: tip,
      });
    });

    conn.on("disconnect", () => {
      isCreatingConnection = false;

      store.dispatch({
        type: "IS_SOCKET_DISCONNECTED",
        payload: true,
      });
    });

    socketConnected = true;
  }
}

const io = {
  leaveStream: (tripId) => conn?.emit("leaveStream", tripId),
  endStream: (data) => conn?.emit("endStream", data),
  allowRemoval: (data) => conn?.emit("allowRemoval", data),
  sendMessage: (message) => conn?.emit("sendMessage", message),
  startStreaming: (data) => conn?.emit("startStreaming", data),
  startStream: (data) => conn?.emit("startStream", data),
  joinStream: (data) => conn?.emit("joinStream", data),
  locationShare: (data) => conn?.emit("locationShare", data),
  removeWatchingStream: () => conn?.emit("removeWatchingStream"),
  removeGuestFromTotal: () => conn?.emit("removeGuestFromTotal"),
  checkConnection: () => conn?.connected,
  getSocket: () => conn,
  disconnectSocket: () => {
    if (conn) {
      conn.disconnect();
      isCreatingConnection = false;
      socketConnected = false;
    }
  },
  connect: (isNewGuest) => {
    if (isNewGuest) {
      isGuest = true;
      isCreatingConnection = false;
    } else if (isGuest) {
      //user signed in from guest
      io.removeGuestFromTotal();
      isCreatingConnection = false;
      isGuest = false;
    }

    if (!isCreatingConnection) {
      conn && conn.disconnect();
      conn = null;
      socketConnected = false;
      isCreatingConnection = true;

      setTimeout(() => {
        ioConnect();
      }, 200);
      return true;
    }
  },
};

export default io;
