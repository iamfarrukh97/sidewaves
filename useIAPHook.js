import { useEffect, useCallback, useState } from 'react'
import { Platform } from 'react-native'
import {
  initConnection,
  endConnection,
  flushFailedPurchasesCachedAsPendingAndroid,
  purchaseErrorListener,
  purchaseUpdatedListener,
  getSubscriptions,
  requestSubscription,
  finishTransaction,
  getAvailablePurchases,
  validateReceiptIos,
  getPendingPurchasesIOS,
  clearProductsIOS,
  clearTransactionIOS,
} from 'react-native-iap'
const itunesConnectSharedSecret = '7fa979130c03453285f5cd43e595b97f'
import * as currentSub from './Sub.json'
const plans = [
  { price: '1.99', level: 'Weekly' },
  { price: '3.99', level: 'Monthly' },
  { price: '9.99', level: 'Yearly' },
]
const useIAPHook = () => {
  const [products, setProducts] = useState([])
  const productSkus = Platform.select({
    ios: { skus: ['Weekly', 'Monthly', 'Yearly'] },
    android: {
      skus: ['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'level7'],
    },
  })
  const processNewPurchase = async purchase => {
    const { productId, transactionReceipt, transactionId } = purchase
    console.log({ productId, transactionId })
    if (transactionReceipt !== undefined && transactionReceipt) {
      //backend call with fetch - validating receipt
      // const finish = await finishTransaction({ purchase: purchase, isConsumable: true })
      // console.log({ finish })
    }
  }
  const validateIosRecipt = sub => {}
  //  to get available subscription
  const getSubscriptionsCallBack = useCallback(async () => {
    try {
      const availableSubscriptions = await getSubscriptions(productSkus)
      if (availableSubscriptions.length > 0) {
        if (Platform.OS === 'android') {
          const newProducts = availableSubscriptions.map((item, index) => {
            return {
              productId: item.productId,
              // image: imagesArray[index],
              // money: moneyArray[index],
              price: item.oneTimePurchaseOfferDetails.formattedPrice,
              currency: item.oneTimePurchaseOfferDetails.formattedPrice,
            }
          })
          setProducts(newProducts)
        } else if (Platform.OS === 'ios') {
          const newProducts = []
          availableSubscriptions.forEach((item, index) => {
            plans.forEach(plan => {
              if (plan.level === item.productId) {
                const temp = {
                  productId: item.productId,
                  price: item.price,
                  currency: item.localizedPrice,
                }
                newProducts.push(temp)
              }
            })
          })
          setProducts(newProducts)
        }
      }
    } catch (error) {
      console.log('error getSubscriptionsCallBack =>', error)
    }
  }, [])
  const handleSaveToDB = async () => {
    const deliverOrDownloadFancyInAppPurchase = data => {
      console.log('data', data)
      const myPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve('foo')
        }, 300)
      })
    }
    return { deliverOrDownloadFancyInAppPurchase }
  }
  const getActiveSubscriptionId = async () => {
    console.log('getActiveSubscriptionId')
    if (Platform.OS === 'ios') {
      // const availablePurchases = await getAvailablePurchases()
      // const sortedAvailablePurchases = availablePurchases.sort(
      //   (a, b) => b.transactionDate - a.transactionDate,
      // )
      // console.log('last transaction id ', sortedAvailablePurchases[0])
      // const latestAvailableReceipt = sortedAvailablePurchases?.[0]?.transactionReceipt
      console.log('transactionId', currentSub.transactionId)

      const latestAvailableReceipt = currentSub.transactionReceipt

      const isTestEnvironment = __DEV__
      const decodedReceipt = await validateReceiptIos({
        receiptBody: {
          'receipt-data': latestAvailableReceipt,
          password: itunesConnectSharedSecret,
        },
        isTest: isTestEnvironment,
      })
      // console.log({ decodedReceipt })
      if (decodedReceipt) {
        const { latest_receipt_info: latestReceipts } = decodedReceipt
        const latestReceiptInfo = latestReceipts[0]
        console.log({ latestReceiptInfo })
        const expirationInMilliseconds = Number(latestReceiptInfo?.expires_date_ms)
        const nowInMilliseconds = Date.now()
        console.log(
          'purchase',
          new Date(
            parseInt(latestReceiptInfo?.original_purchase_date_ms),
          ).toLocaleDateString(),
          ' - ',
          new Date(parseInt(latestReceiptInfo?.original_purchase_date_ms)).toTimeString(),
        )
        console.log(
          'expire',
          new Date(parseInt(latestReceiptInfo?.expires_date_ms)).toLocaleDateString(),
          ' - ',
          new Date(parseInt(latestReceiptInfo?.expires_date_ms)).toTimeString(),
        )
        console.log(
          'now',
          new Date(nowInMilliseconds).toDateString(),
          ' - ',
          new Date(nowInMilliseconds).toTimeString(),
        )
        console.log('cechk', expirationInMilliseconds > nowInMilliseconds)
        if (expirationInMilliseconds > nowInMilliseconds) {
          // console.log(
          //   'sortedAvailablePurchases?.[0].productId',
          //   sortedAvailablePurchases?.[0].productId,
          // )
          return latestReceiptInfo.product_id
        }
      }

      return undefined
    }

    if (Platform.OS === 'android') {
      const availablePurchases = await getAvailablePurchases()

      for (let i = 0; i < availablePurchases.length; i++) {
        if (subSkus.includes(availablePurchases[i].productId)) {
          return availablePurchases[i].productId
        }
      }

      return undefined
    }
  }
  const handlePurchase = async sku => {
    try {
      const request = await requestSubscription({
        sku: sku.productId,
        andDangerouslyFinishTransactionAutomatically: true,
      })
      console.log('handlePurchase success', request)
    } catch (error) {
      console.log('error handlePurchase =>', error)
    }
  }
  useEffect(() => {
    let purchaseUpdateSubscription = null
    let purchaseErrorSubscription = null
    ;(async () => {
      try {
        if (Platform.OS === 'ios') {
          await clearProductsIOS()
          await clearTransactionIOS()
        }
        await initConnection()
        if (Platform.OS === 'android') {
          try {
            await flushFailedPurchasesCachedAsPendingAndroid()
          } catch (err) {
            console.log('flushFailedPurchasesCachedAsPendingAndroid', err)
          }
        }
        purchaseUpdateSubscription = purchaseUpdatedListener(async purchase => {
          console.log({ purchase })
          const receipt = purchase.transactionReceipt
          if (receipt) {
            console.log({ receipt })
            //   handleSaveToDB
            //     .deliverOrDownloadFancyInAppPurchase(purchase.transactionReceipt)
            //     .then(async deliveryResult => {
            //       if (isSuccess(deliveryResult)) {
            // Tell the store that you have delivered what has been paid for.
            // Failure to do this will result in the purchase being refunded on Android and
            // the purchase event will reappear on every relaunch of the app until you succeed
            // in doing the below. It will also be impossible for the user to purchase consumables
            // again until you do this.

            // If consumable (can be purchased again)
            // await finishTransaction({ purchase, isConsumable: true })
            // If not consumable
            // await finishTransaction({ purchase, isConsumable: false })
            //   } else {
            //     // Retry / conclude the purchase is fraudulent, etc...
            //   }
            // })
          }
        })
        purchaseErrorSubscription = purchaseErrorListener(error => {
          console.warn('purchaseErrorListener', error)
        })
        getSubscriptionsCallBack()
        const purchasedSub = await getActiveSubscriptionId()
        console.log({ purchasedSub })
      } catch (error) {
        console.log('error IAP=>', error)
      }
    })()
    return () => {
      if (purchaseUpdateSubscription) {
        purchaseUpdateSubscription.remove()
      }
      if (purchaseErrorSubscription) {
        purchaseErrorSubscription.remove()
      }
      endConnection()
    }
  }, [])
  return { products, handlePurchase }
}
export default useIAPHook
