module.exports = router => {
    router
        .prefix('/api/sales')
        .path(__dirname + '/endpoints')
        .register(router => {
            router.post('authorize-payment', 'AuthorizePayment'); 
            // looks for AuthorizePayment.js, a class named AuthorizePayment, and a function named handler
        }
    );
};