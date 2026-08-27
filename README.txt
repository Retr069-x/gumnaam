GUMNAAM — STATIC STOREFRONT
===========================

WHAT IS INCLUDED
----------------
index.html             Homepage
shop.html              Drop 001 product listing
product.html           Shared product detail template
css/style.css          Shared responsive, monochrome styling
js/products.js         Product catalog and product rendering
js/main.js             Navigation, cart, newsletter and animation logic
assets/                 Supplied Gumnaam logo and hoodie photography


RUN LOCALLY
-----------
The site has no build step and no package dependencies.

Recommended: open a terminal in this folder and run one of these commands:

  python -m http.server 8000

or, on some Windows installations:

  py -m http.server 8000

Then visit:

  http://localhost:8000

You can also double-click index.html, although using a local server is closer to
how the site will behave when hosted.


EDIT PRODUCTS
-------------
Open js/products.js and edit the GUMNAAM_PRODUCTS array near the top of the file.
Each item contains:

  id            Unique URL-safe product ID (used in product.html?id=...)
  number        Collection sequence number
  name          Full displayed product name
  shortName     Short internal label
  price         Numeric sample price in PKR
  stock         Low-stock message value
  description   Product detail copy
  images        Ordered asset paths (first is the primary image)
  sizes         Available size buttons
  material      Material accordion copy
  care          Care accordion copy

To add a product, duplicate one complete object, give it a unique id, add its
photos under assets/, and update the image paths. Product grids and detail pages
render automatically from this array.


IMAGES
------
The site uses the supplied product photography in its original colours while the
surrounding storefront interface remains black, white and gray.
The first image in each product's images array is shown first. The second image is
revealed when a product card is hovered.


CART / CHECKOUT INTEGRATION
---------------------------
The current bag is a front-end demonstration. It stores selected products and
sizes in localStorage under "gumnaam-cart-v1" and updates the bag count across
pages. It does not collect payment or submit orders.

The integration point is window.GumnaamCart.add() in js/main.js. Replace or extend
that method when connecting a real checkout:

  Shopify: map each product/size to a Shopify variant ID and use Storefront API
            or Shopify Buy Button/cart endpoints.

  Stripe:   send the product/price identifier to a secure server endpoint that
            creates a Stripe Checkout Session. Never put a Stripe secret key in JS.

  Custom:   POST the selected product ID, size and quantity to your server-side
            cart/order API, then redirect to the hosted checkout.


NEWSLETTER INTEGRATION
----------------------
The newsletter currently validates the email and shows a confirmation only.
The commented integration point is inside setupNewsletter() in js/main.js.
Connect that block to Mailchimp, Klaviyo or a secure custom form endpoint.


CONTENT TO REVIEW BEFORE LAUNCH
-------------------------------
- Product pricing, stock values, materials and care information are editable copy.
- Contact email: gumnaamofficialpk@gmail.com.
- Instagram: https://www.instagram.com/gumnaamclothingpk/.
- Delivery language should be updated to match the final fulfilment policy.
- Connect a real checkout and newsletter provider before accepting orders.
