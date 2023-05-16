import React, { useCallback, useEffect, useState } from 'react'
import { Alert, EmitterSubscription, Platform } from 'react-native'
import {
  clearProductsIOS,
  clearTransactionIOS,
  endConnection,
  finishTransaction,
  flushFailedPurchasesCachedAsPendingAndroid,
  getAvailablePurchases,
  getSubscriptions,
  initConnection,
  Product,
  ProductPurchase,
  promotedProductListener,
  PurchaseError,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestSubscription,
  Sku,
  Subscription,
  SubscriptionPurchase,
} from 'react-native-iap'
import axios from 'axios'

import {
  subscriptionSkus,
  subscriptionPlans,
  imagesArray,
  validationServer,
} from './constants'
import { errorLog } from './errorLogs'
import { useAuthSelector } from '@store'
interface State {
  productList: (Product | Subscription)[]
  receipt: string
  availableItemsMessage: string
}

const InAppPurchaseHook = () => {
  let purchaseUpdate: EmitterSubscription | null = null
  let purchaseError: EmitterSubscription | null = null
  let promotedProduct: EmitterSubscription | null = null
  const { userId } = useAuthSelector(state => state)
  const [subscriptionList, setSubscriptionList] = useState<any[]>([])
  const [isLoadingPay, setIsLoadingPay] = useState<boolean>(false)
  const [isLoadingSub, setIsLoadingSub] = useState<boolean>(false)
  const [receipt, setReceipt] = useState('')
  const [availableItemsMessage, setAvailableItemsMessage] = useState('')
  const getSubscriptionsHandle = useCallback(async () => {
    try {
      const subscription = await getSubscriptions(subscriptionSkus)
      if (subscription.length === 0) return
      if (Platform.OS === 'android') {
        const newProducts = subscription.map((item, index) => {
          return {
            productId: item.productId,
            image: imagesArray[index],
            price:
              item.subscriptionOfferDetails[0].pricingPhases.pricingPhaseList[0]
                .formattedPrice,
            currency:
              item.subscriptionOfferDetails[0].pricingPhases.pricingPhaseList[0]
                .priceCurrencyCode,
            offerToken: item.subscriptionOfferDetails[0].offerToken,
          }
        })
        setSubscriptionList(newProducts)
      } else if (Platform.OS === 'ios') {
        const newProducts = subscription.map((item, index) => {
          return {
            productId: item.productId,
            price: item.price,
            image: imagesArray[index],
            currency: item.localizedPrice,
          }
        })
        setSubscriptionList(newProducts)
      }
    } catch (error) {
      errorLog({ message: 'getSubscriptions', error })
    }
  }, [])

  const getAvailablePurchasesHandle = async () => {
    try {
      const purchases = await getAvailablePurchases()
      // console.log(Platform.OS, 'purchase', purchases.length)
      if (purchases?.length > 0) {
        setReceipt(purchases[0]!.transactionReceipt)
        setAvailableItemsMessage(`Got ${purchases.length} items.`)
      }
    } catch (error) {
      errorLog({ message: 'getAvailablePurchases', error })
    }
  }
  //  try {
  //       await axios.get(`${validationServer}/iap/getSubscription/:appType`, {
  //         params: { appType: 'android' },
  //       })
  //     } catch (error) {
  //       console.log('axios error', error)
  //     }
  const buySubscriptionHandle = async (productId: string, offerToken?: string) => {
    setIsLoadingSub(true)
    if (Platform.OS === 'android' && !offerToken) {
      console.warn(
        `There are no subscription Offers for selected product (Only requiered for Google Play purchases): ${productId}`,
      )
    }
    try {
      await requestSubscription({
        sku: productId,
        ...(offerToken && {
          subscriptionOffers: [{ sku: productId, offerToken }],
        }),
      })
      setIsLoadingSub(false)
    } catch (error) {
      if (error instanceof PurchaseError) {
        errorLog({ message: `[${error.code}]: ${error.message}`, error })
      } else {
        errorLog({ message: 'handleBuySubscription', error })
      }
      setIsLoadingSub(false)
    }
  }
  useEffect(() => {
    ;(async () => {
      try {
        await initConnection()

        if (Platform.OS === 'android') {
          await flushFailedPurchasesCachedAsPendingAndroid()
        } else {
          /**
           * WARNING This line should not be included in production code
           * This call will call finishTransaction in all pending purchases
           * on every launch, effectively consuming purchases that you might
           * not have verified the receipt or given the consumer their product
           *
           * TL;DR you will no longer receive any updates from Apple on
           * every launch for pending purchases
           */
          await clearProductsIOS()
          await clearTransactionIOS()
        }
        getSubscriptionsHandle()
        // getAvailablePurchasesHandle()
      } catch (error) {
        if (error instanceof PurchaseError) {
          errorLog({ message: `[${error.code}]: ${error.message}`, error })
        } else {
          errorLog({ message: 'finishTransaction', error })
        }
      }
    })()
    purchaseUpdate = purchaseUpdatedListener(
      async (purchase: ProductPurchase | SubscriptionPurchase) => {
        setIsLoadingPay(true)
        const receipt = purchase.transactionReceipt
          ? purchase.transactionReceipt
          : (purchase as unknown as { originalJson: string }).originalJson
        if (receipt) {
          try {
            await finishTransaction({ purchase })
            await axios.post(`${validationServer}/iap/saveReceipt`, {
              userId,
              appType: Platform.OS,
              purchase,
            })
          } catch (error) {
            errorLog({ message: 'finishTransaction', error })
          }
          setIsLoadingPay(false)
        }
      },
    )

    purchaseError = purchaseErrorListener((error: PurchaseError) => {
      Alert.alert('purchase error', JSON.stringify(error))
    })

    promotedProduct = promotedProductListener((productId?: string) =>
      Alert.alert('Product promoted', productId),
    )
    return () => {
      purchaseUpdate?.remove()
      purchaseError?.remove()
      promotedProduct?.remove()
      endConnection()
    }
  }, [])
  return {
    subscriptionList,
    isLoadingSub,
    getAvailablePurchasesHandle,
    buySubscriptionHandle,
  }
}

export { InAppPurchaseHook }
