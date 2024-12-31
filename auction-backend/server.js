const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const argon2 = require('argon2');
require('dotenv').config(); // Import and configure dotenv
// Import the User model
const User = require('./models/User');
const Admin = require('./models/Admin');
const Bidder = require('./models/Bidder');
const Auctioneer = require('./models/Auctioneer');
const Auction = require('./models/Auction');
const Item = require('./models/Item');
const Bid = require('./models/Bid');
const app = express();
const multer = require('multer');
const fs = require('fs');

// Set up Multer storage configuration for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null,  path.join(__dirname, '../Auction-Bazaar/public')); // Image folder location
  },
  filename: (req, file, cb) => {
    const itemName = req.body.name.replace(/\s+/g, '_'); // Replace spaces with underscores
    const fileExtension = path.extname(file.originalname); // Get file extension
    const timestamp = Date.now();
    cb(null, `${itemName}_${timestamp}${fileExtension}`); // Save with the product name and extension
  }
});

const upload = multer({ storage });

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection (Using .env file for sensitive data)
const MONGO_URI = process.env.MONGO_URI; // Fetch from environment variables
if (!MONGO_URI) {
  console.error('MONGO_URI is not defined in .env file');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes

// User Registration
app.post('/register', async (req, res) => {
  const { name, username, email, password, role } = req.body;

  try {
    // Check if the user already exists
    const existingUser = await User.findOne({ email });

    // If the user exists, check the bidder and auctioneer values
    if (existingUser && await existingUser.isValidPassword(password)) {
      if (existingUser.bidder !== null && existingUser.auctioneer !== null) {
        return res.status(400).send({ error: 'User already registered as both Bidder and Auctioneer' });
      }

      if (existingUser.name !== name || existingUser.username !== username) {
        return res.status(400).send({
          error: `User already registered \ 
                                              as ${existingUser.bidder ? 'Bidder' : ''} ${existingUser.auctioneer ? 'Auctioneer' : ''}\n\
                                               But invalid Name or Username` });
      }

      // If role is Bidder and bidder is null, register the user as a Bidder
      if (role === 'bidder' && existingUser.bidder === null) {
        const bidder = new Bidder({ userId: existingUser._id });
        await bidder.save();
        existingUser.bidder = bidder._id;
        await existingUser.save();
        return res.status(200).send({ message: 'User registered as Bidder successfully!' });
      }

      // If role is Auctioneer and auctioneer is null, register the user as an Auctioneer
      if (role === 'auctioneer' && existingUser.auctioneer === null) {
        const auctioneer = new Auctioneer({ userId: existingUser._id });
        await auctioneer.save();
        existingUser.auctioneer = auctioneer._id;
        await existingUser.save();
        return res.status(200).send({ message: 'User registered as Auctioneer successfully!' });
      }

      // If the user is trying to register for a role they already have, return an error
      return res.status(400).send({ error: `User already registered as ${existingUser.bidder ? 'Bidder' : ''} ${existingUser.auctioneer ? 'Auctioneer' : ''}` });
    }

    // If the user doesn't exist, proceed with registration
    // Check if the role is Admin
    if (role === 'admin') {
      const admin = new Admin({
        name,
        username,
        email,
        password, // Store the hashed password
      });
      await admin.save();
      return res.status(201).send({ message: 'Admin registered successfully!' });
    }

    // Register as Bidder or Auctioneer - Store data in User collection
    const user = new User({
      name,
      username,
      email,
      password, // Store the hashed password
      bidder: null,
      auctioneer: null
    });

    // If the role is Bidder, create a Bidder document and assign it to the user
    if (role === 'bidder') {
      const bidder = new Bidder({ userId: user._id });
      await bidder.save();
      user.bidder = bidder._id;
    }
    // If the role is Auctioneer, create an Auctioneer document and assign it to the user
    else if (role === 'auctioneer') {
      const auctioneer = new Auctioneer({ userId: user._id });
      await auctioneer.save();
      user.auctioneer = auctioneer._id;
    }

    await user.save();
    res.status(201).send({ message: 'User registered successfully!' });

  } catch (err) {
    console.log(err);
    res.status(400).send({ error: err.message });
  }
});

// User Login
app.post('/login', async (req, res) => {
  const { email, password, role } = req.body;

  try {
    // Check if the role is Admin
    if (role === 'admin') {
      const admin = await Admin.findOne({ email });
      if (!admin) {
        return res.status(400).send({ error: 'Invalid email or password' });
      }
      if (!await admin.isValidPassword(password)) {
        return res.status(400).send({ error: 'Invalid email or password' });
      }

      // Generate token (Assuming generateToken function is defined)
      //const token = generateToken(admin._id);
      return res.status(200).send({
        message: 'Login successful',
        // token,
        user: {
          _id: admin._id,
          username: admin.username,
          email: admin.email,
          name: admin.name,
          profilePicture: admin.profilePicture,
          phone: admin.phone,
          permissions: admin.permissions,
        }
      });
    }

    // Check if the role is User (Bidder or Auctioneer)
    if (role === 'bidder' || role === 'auctioneer') {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).send({ error: 'Invalid email or password' });
      }

      // const isMatch = await argon2.verify(user.password, password); // Using argon2 to verify password
      if (!await user.isValidPassword(password)) {
        return res.status(400).send({ error: 'Invalid email or password' });
      }

      // If role is Bidder, ensure user has a bidder account
      if (role === 'bidder' && user.bidder === null) {
        return res.status(400).send({ error: 'User is not registered as a Bidder' });
      }

      // If role is Auctioneer, ensure user has an auctioneer account
      if (role === 'auctioneer' && user.auctioneer === null) {
        return res.status(400).send({ error: 'User is not registered as an Auctioneer' });
      }

      // Generate token (Assuming generateToken function is defined)
      //const token = generateToken(user._id);
      return res.status(200).send({
        message: 'Login successful',
        // token,
        user: {
          _id: user._id,
          username: user.username,
          email: user.email,
          name: user.name,
          profilePicture: user.profilePicture,
          phone: user.phone,
          bidder: user.bidder,
          auctioneer: user.auctioneer,
        }
      });
    }
    return res.status(400).send({ error: 'Invalid role specified' });
  } catch (err) {
    console.log("error", err);
    res.status(500).send({ error: 'Server error' });
  }
});

// Handle the auction creation and product image upload
app.post('/create-auction', upload.single('itemImage'), async (req, res) => {
  try {
    const { auctioneerId, description, startTime, endTime, startingPrice, name, category } = req.body;

    // Ensure startTime and endTime are Date objects (convert to Date if they are strings)
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const now = new Date();

    // Create a new auction object
    const auction = new Auction({
      auctioneerId,
      startTime: startDate, // Store as Date object
      endTime: endDate,     // Store as Date object
      startingPrice,
      status: startDate > now ? "Not Started" : "Active",
      //items: savedItem._id // Link the auction with the saved item
    });

    // Save the auction
    const savedAuction = await auction.save();

    // Save the product/item information
    const item = new Item({
      name: name,
      category: category,
      description: description,
      auctionId: savedAuction._id, // AuctionId will be linked later
      image: `${req.file.filename}` // Path to the uploaded image
    });

    // Save the item
    const savedItem = await item.save();

    // Update the item's auctionId with the created auction's ID
    savedAuction.item = savedItem._id;
    await savedAuction.save();
    const remainingTime = new Date(savedAuction.endTime) - new Date();
    // Return success response
    res.status(201).json({
      productName: name,
      description: description,
      minPrice: startingPrice,
      currentBid: startingPrice,
      category: category,
      status: savedAuction.status,
      remainingTime: remainingTime,
      endDate: savedAuction.endTime.toISOString(),
      image: savedItem.image
    });

  } catch (error) {
    console.error('Error creating auction and item:', error);
    res.status(500).json({ error: 'Failed to create auction and item' });
  }
});

app.get('/users/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Find the user by userId
    const user = await User.findById(userId)
      .populate('auctioneer') // Populate auctioneer if it exists
      .populate('bidder'); // Populate bidder if it exists

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    // console.log(user);
    res.json(user);  // Return the user details
  } catch (err) {
    console.log(err);
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

//get all auctions of that auctioneer
app.get('/auctions/:auctioneerId', async (req, res) => {
  const { auctioneerId } = req.params;

  try {
    // Find all auctions by auctioneerId and populate the item field
    const auctions = await Auction.find({ auctioneerId })
  .populate({
    path: 'item', // Populate the `item` field
    model: 'Item', // Reference the `Item` model
    populate: {
      path: 'bids', // Populate the `bids` field within `item`
      model: 'Bid', // Reference the `Bid` model
    },
  })
  .exec();

    // Check if auctions exist
    if (!auctions || auctions.length === 0) {
      return res.status(404).json({ message: 'No auctions found' });
    }

    // Process each auction
    const processedAuctions = auctions.map(auction => {
      const item = auction.item; // Single item per auction
      const remainingTimeInMillis = new Date(auction.endDate).getTime() - new Date().getTime();
      // Calculate highest bid or use starting price
      const highestBid = item && item.bids && item.bids.length > 0
        ? item.bids[item.bids.length - 1].bidAmount
        : auction.startingPrice;
      return {
        _id: auction._id,
        auctioneerId: auction.auctioneerId,
        productName: item.name,
        description: item.description,
        minPrice: auction.startingPrice,
        currentBid: highestBid,
        category: item.category,
        status: auction.status,
        remainingTime: remainingTimeInMillis.toString(), // Assuming this function exists
        endDate: new Date(auction.endTime),
        image: item.image,
        bids: item.bids || [],
        soldDate: auction.status === 'Ended' && auction.completedTime
          ? new Date(auction.completedTime)
          : null,
        salePrice: auction.status === 'Ended' ? item.salePrice || 0 : 0,
        startDate: new Date(auction.startTime)
      };
    });

    res.status(200).json(processedAuctions);
  } catch (error) {
    console.error('Error fetching auctions:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.put('/auctions/:auctionId', async (req, res) => {
  const { auctionId } = req.params;
  const { status, salePrice, bid } = req.body;  // Only a single bid

  try {
    // Fetch the auction first to retrieve associated item details
    const auction = await Auction.findById(auctionId).populate({
      path: 'item',
      populate: {
        path: 'bids', // Populate auctionId within the populated itemId
      },
    }).exec();
    const profit = salePrice - auction.startingPrice;
    const auctioneer = await Auctioneer.findById(auction.auctioneerId);
    const updatedTotalProfit = (auctioneer.totalProfit || 0) + profit;
    const updatedTotalSales = (auctioneer.totalSales || 0) + salePrice;

    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }

    // Build the update object for the auction dynamically
    const updateFields = {};

    if (status) updateFields.status = status;
    if (status === 'Ended' && salePrice !== undefined) {
      // Update the item with the sale price
      const updatedItem = await Item.findByIdAndUpdate(
        auction.item._id,
        { $set: { salePrice: salePrice } },
        { new: true }
      );
    
      // Update the auctioneer with new profit and sales totals
      const updateAuctioneer = await Auctioneer.findByIdAndUpdate(
        auction.auctioneerId,
        {
          $set: {
            totalProfit: updatedTotalProfit,
            totalSales: updatedTotalSales,
          },
        },
        { new: true }
      );
    if (updatedItem.bids.length>0){
      // Get the bidder by the last bid in the item's bids array
      console.log(updatedItem.bids[updatedItem.bids.length - 1].toString());
      const bid1=await Bid.findById(updatedItem.bids[updatedItem.bids.length - 1].toString());
      const lastBidderId =bid1.bidderId;
      if (lastBidderId) {
        const bidder = await Bidder.findById(lastBidderId);
        console.log(bidder);
        if (bidder) {
          const updatedTotalSpent = (bidder.totalSpent || 0) + salePrice;
          // Update the bidder's total spent
          await Bidder.findByIdAndUpdate(
            lastBidderId,
            { $set: { totalSpent: updatedTotalSpent } },
            { new: true }
          );
        }
      }}
    
      // Update the auction with the completed time
      updateFields.completedTime = new Date();
    }
    

    // Update the auction's status and sale price if applicable
    const updatedAuction = await Auction.findByIdAndUpdate(
      auctionId,
      { $set: updateFields },
      { new: true } // Return the updated document
    );

    // If a bid is provided, update the associated item's bids
    if (bid && auction.item) {
      const updatedItem = await Item.findByIdAndUpdate(
        auction.item._id,
        { $push: { bids: bid } }, // Push the single bid to the array
        { new: true } // Return the updated document
      );

      if (!updatedItem) {
        return res.status(404).json({ message: 'Associated item not found' });
      }
    }

    res.status(200).json({
      message: 'Auction and associated item updated successfully',
      updatedAuction,
    });
  } catch (error) {
    console.error('Error updating auction:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/bids-dashboard/:bidderId', async (req, res) => {
  try {
    const { bidderId } = req.params;

    // Fetch participated bids
    const participatedBids = await Bid.find({ bidderId })
      .populate({
        path: 'itemId',
        populate: {
          path: 'auctionId', // Populate auctionId within the populated itemId
        },
      })
      .exec();

    // Fetch won bids (items with a sale price)
    const wonBids = await Bid.find({ bidderId })
      .populate({
        path: 'itemId',
        populate: {
          path: 'auctionId', // Populate auctionId within the populated itemId
        },
        match: { salePrice: { $exists: true } },
        select: 'name description category image salePrice ',
      })
      .exec();

    const filteredWonBids = wonBids.filter((bid) => bid.itemId);

    // Fetch all auctions
    const allAuctions = await Auction.find()
    .populate({
      path: 'item',
      populate: {
        path: 'bids',
      },
    })
      .exec();

    // Response
    res.json({
      participatedBids,
      wonBids: filteredWonBids,
      allAuctions,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

app.post('/place-bid', async (req, res) => {
  try {
    const { bidderId, itemId, bidAmount } = req.body;
    console.log(bidderId,itemId,bidAmount);
    const bidder=await Bidder.findById(bidderId);
    const user = await User.findById(bidder.userId);
    // Validate input
    if (!bidderId || !itemId) {
      console.log("hii");
      return res.status(400).json({ error: 'All fields are required.' });
    }

    // Fetch the item and auction details
    const item = await Item.findById(itemId).populate('auctionId');
    if (!item) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    const auction = item.auctionId;
    if (!auction) {
      return res.status(404).json({ error: 'Auction not associated with the item.' });
    }
    if (auction.auctioneerId.toString()===user.auctioneer?.toString()){
      return res.status(404).json({error:'Cannot Bid Your own item'})
    }

    // Check if auction is active
    if (auction.status !== 'Active') {
      console.log("hii11");

      return res.status(400).json({ error: 'Auction is not active.' });
    }

    // Create a new bid
    const newBid = new Bid({
      bidderId,
      itemId,
      bidAmount,
    });

    await newBid.save();

    // Push the new bid into the item's bids array
    await Item.findByIdAndUpdate(itemId, {
      $push: { bids: newBid._id },
    });

    res.status(201).json({ message: 'Bid placed successfully.', bid: newBid });
  } catch (error) {
    res.status(500).json({
      error: 'Server error',
      details: error.message,
    });
  }
});






// Start Server
const PORT = process.env.PORT || 5000; // Hardcoded port value
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
