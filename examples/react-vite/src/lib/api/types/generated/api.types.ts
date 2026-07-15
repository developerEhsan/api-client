/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Regenerate via the @developerehsan/api-client codegen; manual edits are lost.
 * source: Swagger Petstore - OpenAPI 3.0 v1.0.27 (OpenAPI 3.0.4)
 * generatedAt: 2026-07-11T20:15:27.114Z
 * sourceHash: ee0d6198
 *
 * Emission scheme:
 *  - components -> `export interface`/`export type`
 *  - operations -> one `export interface OperationsMap` keyed by operationId,
 *    each entry `{ params; query; body; response }`
 *  - `export type ApiPaths` mirrors path -> method -> operationId
 */

export interface ApiResponse {
  code?: number
  message?: string
  type?: string
}

export interface Category {
  id?: number
  name?: string
}

export interface Order {
  complete?: boolean
  id?: number
  petId?: number
  quantity?: number
  shipDate?: string
  /** Order Status */
  status?: "placed" | "approved" | "delivered"
}

export interface Pet {
  category?: Category
  id?: number
  name: string
  photoUrls: string[]
  /** pet status in the store */
  status?: "available" | "pending" | "sold"
  tags?: Tag[]
}

export interface Tag {
  id?: number
  name?: string
}

export interface User {
  email?: string
  firstName?: string
  id?: number
  lastName?: string
  password?: string
  phone?: string
  /** User Status */
  userStatus?: number
  username?: string
}

export interface OperationsMap {
  /** Add a new pet to the store. */
  addPet: {
    params: {}
    query: {}
    body: Pet
    response: Pet
  }
  /** Create user. */
  createUser: {
    params: {}
    query: {}
    body: User
    response: User
  }
  /** Creates list of users with given input array. */
  createUsersWithListInput: {
    params: {}
    query: {}
    body: User[]
    response: User
  }
  /** Delete purchase order by identifier. */
  deleteOrder: {
    params: {
      /** ID of the order that needs to be deleted */
      orderId: number
    }
    query: {}
    body: never
    response: unknown
  }
  /** Deletes a pet. */
  deletePet: {
    params: {
      /** Pet id to delete */
      petId: number
    }
    query: {}
    body: never
    response: unknown
  }
  /** Delete user resource. */
  deleteUser: {
    params: {
      /** The name that needs to be deleted */
      username: string
    }
    query: {}
    body: never
    response: unknown
  }
  /** Finds Pets by status. */
  findPetsByStatus: {
    params: {}
    query: {
      /** Status values that need to be considered for filter */
      status: "available" | "pending" | "sold"
    }
    body: never
    response: Pet[]
  }
  /** Finds Pets by tags. */
  findPetsByTags: {
    params: {}
    query: {
      /** Tags to filter by */
      tags: string[]
    }
    body: never
    response: Pet[]
  }
  /** Returns pet inventories by status. */
  getInventory: {
    params: {}
    query: {}
    body: never
    response: {
      [key: string]: number
    }
  }
  /** Find purchase order by ID. */
  getOrderById: {
    params: {
      /** ID of order that needs to be fetched */
      orderId: number
    }
    query: {}
    body: never
    response: Order
  }
  /** Find pet by ID. */
  getPetById: {
    params: {
      /** ID of pet to return */
      petId: number
    }
    query: {}
    body: never
    response: Pet
  }
  /** Get user by user name. */
  getUserByName: {
    params: {
      /** The name that needs to be fetched. Use user1 for testing */
      username: string
    }
    query: {}
    body: never
    response: User
  }
  /** Logs user into the system. */
  loginUser: {
    params: {}
    query: {
      /** The password for login in clear text */
      password?: string
      /** The user name for login */
      username?: string
    }
    body: never
    response: string
  }
  /** Logs out current logged in user session. */
  logoutUser: {
    params: {}
    query: {}
    body: never
    response: unknown
  }
  /** Place an order for a pet. */
  placeOrder: {
    params: {}
    query: {}
    body: Order
    response: Order
  }
  /** Update an existing pet. */
  updatePet: {
    params: {}
    query: {}
    body: Pet
    response: Pet
  }
  /** Updates a pet in the store with form data. */
  updatePetWithForm: {
    params: {
      /** ID of pet that needs to be updated */
      petId: number
    }
    query: {
      /** Name of pet that needs to be updated */
      name?: string
      /** Status of pet that needs to be updated */
      status?: string
    }
    body: never
    response: Pet
  }
  /** Update user resource. */
  updateUser: {
    params: {
      /** name that need to be deleted */
      username: string
    }
    query: {}
    body: User
    response: unknown
  }
  /** Uploads an image. */
  uploadFile: {
    params: {
      /** ID of pet to update */
      petId: number
    }
    query: {
      /** Additional Metadata */
      additionalMetadata?: string
    }
    body: string
    response: ApiResponse
  }
}

export type ApiPaths = {
  "/pet": {
    POST: "addPet"
    PUT: "updatePet"
  }
  "/pet/findByStatus": {
    GET: "findPetsByStatus"
  }
  "/pet/findByTags": {
    GET: "findPetsByTags"
  }
  "/pet/{petId}": {
    DELETE: "deletePet"
    GET: "getPetById"
    POST: "updatePetWithForm"
  }
  "/pet/{petId}/uploadImage": {
    POST: "uploadFile"
  }
  "/store/inventory": {
    GET: "getInventory"
  }
  "/store/order": {
    POST: "placeOrder"
  }
  "/store/order/{orderId}": {
    DELETE: "deleteOrder"
    GET: "getOrderById"
  }
  "/user": {
    POST: "createUser"
  }
  "/user/createWithList": {
    POST: "createUsersWithListInput"
  }
  "/user/login": {
    GET: "loginUser"
  }
  "/user/logout": {
    GET: "logoutUser"
  }
  "/user/{username}": {
    DELETE: "deleteUser"
    GET: "getUserByName"
    PUT: "updateUser"
  }
}
