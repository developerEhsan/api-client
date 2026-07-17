/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Regenerate via the @developerehsan/api-client codegen; manual edits are lost.
 * source: DummyJSON API v1.0.0 (OpenAPI 3.0.3)
 * generatedAt: 2026-07-17T14:09:23.260Z
 * sourceHash: 7aefd8ae
 *
 * Emission scheme:
 *  - components -> `export interface`/`export type`
 *  - operations -> one `export interface OperationsMap` keyed by operationId,
 *    each entry `{ params; query; body; response }`
 *  - `export type ApiPaths` mirrors path -> method -> operationId
 */

export interface AuthUser {
  accessToken?: string
  email?: string
  firstName?: string
  gender?: string
  id?: number
  image?: string
  lastName?: string
  refreshToken?: string
  username?: string
}

export interface Cart {
  discountedTotal?: number
  id: number
  products?: {
    id?: number
    price?: number
    quantity?: number
    title?: string
    total?: number
  }[]
  total?: number
  totalProducts?: number
  totalQuantity?: number
  userId?: number
}

export interface CartList {
  carts: Cart[]
  limit: number
  skip: number
  total: number
}

export interface Category {
  name?: string
  slug?: string
  url?: string
}

export interface LoginInput {
  expiresInMins?: number
  password: string
  username: string
}

export interface Post {
  body?: string
  id: number
  reactions?: {
    dislikes?: number
    likes?: number
  }
  tags?: string[]
  title: string
  userId?: number
  views?: number
}

export interface PostList {
  limit: number
  posts: Post[]
  skip: number
  total: number
}

export interface Product {
  brand?: string
  category?: string
  description?: string
  discountPercentage?: number
  id: number
  images?: string[]
  price: number
  rating?: number
  stock?: number
  thumbnail?: string
  title: string
}

export interface ProductInput {
  brand?: string
  category?: string
  description?: string
  price?: number
  stock?: number
  title: string
}

export interface ProductList {
  limit: number
  products: Product[]
  skip: number
  total: number
}

export interface User {
  age?: number
  email?: string
  firstName?: string
  gender?: string
  id: number
  image?: string
  lastName?: string
  phone?: string
  username?: string
}

export interface UserList {
  limit: number
  skip: number
  total: number
  users: User[]
}

export interface OperationsMap {
  /** Add a product (simulated). */
  addProduct: {
    params: {}
    query: {}
    body: ProductInput
    response: Product
  }
  /** Delete a product (simulated). */
  deleteProduct: {
    params: {
      id: number
    }
    query: {}
    body: never
    response: Product
  }
  /** Fetch one cart by id. */
  getCartById: {
    params: {
      id: number
    }
    query: {}
    body: never
    response: Cart
  }
  /** The current user (requires a bearer token). */
  getCurrentUser: {
    params: {}
    query: {}
    body: never
    response: User
  }
  /** Fetch one post by id. */
  getPostById: {
    params: {
      id: number
    }
    query: {}
    body: never
    response: Post
  }
  /** Fetch one product by id. */
  getProductById: {
    params: {
      id: number
    }
    query: {}
    body: never
    response: Product
  }
  /** Fetch one user by id. */
  getUserById: {
    params: {
      id: number
    }
    query: {}
    body: never
    response: User
  }
  /** List carts (paginated). */
  listCarts: {
    params: {}
    query: {
      limit?: number
      skip?: number
    }
    body: never
    response: CartList
  }
  /** List posts (paginated). */
  listPosts: {
    params: {}
    query: {
      limit?: number
      skip?: number
    }
    body: never
    response: PostList
  }
  /** All product categories. */
  listProductCategories: {
    params: {}
    query: {}
    body: never
    response: Category[]
  }
  /** List products (paginated via limit/skip). */
  listProducts: {
    params: {}
    query: {
      /** Page size. */
      limit?: number
      /** Comma-separated fields. */
      select?: string
      /** Offset. */
      skip?: number
    }
    body: never
    response: ProductList
  }
  /** List users (paginated). */
  listUsers: {
    params: {}
    query: {
      limit?: number
      skip?: number
    }
    body: never
    response: UserList
  }
  /** Exchange credentials for an access token. */
  login: {
    params: {}
    query: {}
    body: LoginInput
    response: AuthUser
  }
  /** Search products (paginated). */
  searchProducts: {
    params: {}
    query: {
      limit?: number
      q: string
      skip?: number
    }
    body: never
    response: ProductList
  }
  /** Update a product (simulated). */
  updateProduct: {
    params: {
      id: number
    }
    query: {}
    body: ProductInput
    response: Product
  }
}

export type ApiPaths = {
  "/auth/login": {
    POST: "login"
  }
  "/auth/me": {
    GET: "getCurrentUser"
  }
  "/carts": {
    GET: "listCarts"
  }
  "/carts/{id}": {
    GET: "getCartById"
  }
  "/posts": {
    GET: "listPosts"
  }
  "/posts/{id}": {
    GET: "getPostById"
  }
  "/products": {
    GET: "listProducts"
  }
  "/products/add": {
    POST: "addProduct"
  }
  "/products/categories": {
    GET: "listProductCategories"
  }
  "/products/search": {
    GET: "searchProducts"
  }
  "/products/{id}": {
    DELETE: "deleteProduct"
    GET: "getProductById"
    PUT: "updateProduct"
  }
  "/users": {
    GET: "listUsers"
  }
  "/users/{id}": {
    GET: "getUserById"
  }
}
