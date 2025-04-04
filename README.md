# Escrow-Based NFT Marketplace

### Design

The program assume the seller already created the **Associated Token Account (ATA)** with mint authority set to themselve. During the listing, the program will use this **ATA** to transfer the nft. For each nft listed the program will create a respective **Escrow Token Account** to store the nft and respective **Metadata Account** to store the nft listing information such as price and payment token. Upon purchase, the program will **initialize (if needed)** the token account for the buyer to receive the nft, and the payment token account for seller to receive the payment. After that, the program will **close** the Escrow Token Account and the Metadata Accoount, and free up the rent and send back to the seller.

